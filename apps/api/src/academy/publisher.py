import hashlib
import hmac
import json
import logging
import os
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.academy.publisher_projection import project_graph
from src.academy.publisher_readback import verify_readback
from src.academy.publisher_rollback import archive_graph, verify_archived
from src.core.events.database import get_db_session
from src.db.academy_publications import AcademyPublication, AcademyPublicationRead
from src.db.organizations import Organization

logger = logging.getLogger(__name__)
router = APIRouter()
PUBLICATION_LOCK_KEY = 0x5452454C4C495341


class AcademyReleaseRequest(BaseModel):
    compiled_digest: str
    graph: dict[str, Any]
    operator_instruction: str
    release_tag: str
    environment: str
    rollback_target: str

    @field_validator(
        "compiled_digest",
        "operator_instruction",
        "release_tag",
        "environment",
        "rollback_target",
    )
    @classmethod
    def require_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value.strip()


class AcademyRollbackRequest(BaseModel):
    operator_instruction: str
    release_tag: str
    environment: str

    @field_validator("operator_instruction", "release_tag", "environment")
    @classmethod
    def require_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value.strip()


def require_publisher_principal(request: Request) -> None:
    configured = os.environ.get("TRELLIS_ACADEMY_PUBLISHER_SECRET", "")
    if not configured:
        logger.error("Trellis Academy publisher principal is not configured")
        raise HTTPException(status_code=503, detail="Academy publisher is unavailable")
    authorization = request.headers.get("authorization", "")
    supplied = (
        authorization.removeprefix("Bearer ")
        if authorization.startswith("Bearer ")
        else ""
    )
    if not supplied or not hmac.compare_digest(supplied, configured):
        raise HTTPException(
            status_code=401, detail="Invalid Academy publisher principal"
        )


def _canonical_digest(value: dict[str, Any]) -> str:
    canonical = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


async def _acquire_publication_lock(db_session: AsyncSession) -> None:
    """Serialize release projection and rollback for the Academy database."""
    if db_session.get_bind().dialect.name == "postgresql":
        await db_session.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": PUBLICATION_LOCK_KEY},
        )


async def _organization(db_session: AsyncSession) -> Organization:
    slug = os.environ.get("TRELLIS_ACADEMY_ORG_SLUG", "").strip()
    organization = (
        (await db_session.execute(select(Organization).where(Organization.slug == slug)))
        .scalars()
        .first()
    )
    if not slug or organization is None or organization.id is None:
        raise HTTPException(
            status_code=503, detail="Academy organization is unavailable"
        )
    return organization


@router.get("/releases/current", response_model=AcademyPublicationRead)
async def get_current_academy_release(
    db_session: AsyncSession = Depends(get_db_session),
) -> AcademyPublicationRead:
    current = (
        (
            await db_session.execute(
                select(AcademyPublication).order_by(AcademyPublication.id.desc())
            )
        )
        .scalars()
        .first()
    )
    if current is None:
        raise HTTPException(status_code=404, detail="Academy has no published release")
    return AcademyPublicationRead.model_validate(current)


@router.post("/releases", response_model=AcademyPublicationRead)
async def publish_academy_release(
    body: AcademyReleaseRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> AcademyPublicationRead:
    if _canonical_digest(body.graph) != body.compiled_digest:
        raise HTTPException(
            status_code=422, detail="Compiled digest does not match graph"
        )
    source_commit = body.graph.get("sourceCommit")
    if not isinstance(source_commit, str) or not source_commit:
        raise HTTPException(
            status_code=422, detail="Compiled graph has no source commit"
        )

    await _acquire_publication_lock(db_session)

    existing = (
        (
            await db_session.execute(
                select(AcademyPublication).where(
                    AcademyPublication.release_tag == body.release_tag
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        if existing.compiled_digest != body.compiled_digest:
            raise HTTPException(
                status_code=409, detail="Academy release tag is immutable"
            )
        current = (
            (
                await db_session.execute(
                    select(AcademyPublication).order_by(AcademyPublication.id.desc())
                )
            )
            .scalars()
            .first()
        )
        if current is None or current.id != existing.id:
            raise HTTPException(status_code=409, detail="Academy release tag is not current")
        organization = await _organization(db_session)
        await verify_readback(body, db_session, organization)
        return AcademyPublicationRead.model_validate(existing)

    organization = await _organization(db_session)
    previous = (
        (
            await db_session.execute(
                select(AcademyPublication).order_by(AcademyPublication.id.desc())
            )
        )
        .scalars()
        .first()
    )
    expected_rollback_target = (
        previous.release_tag if previous is not None else "academy-release/empty"
    )
    if body.rollback_target != expected_rollback_target:
        raise HTTPException(
            status_code=409,
            detail="Academy rollback target does not match the current release",
        )
    try:
        await project_graph(body, db_session, organization)
        readback_digest = await verify_readback(body, db_session, organization)
        receipt = AcademyPublication(
            receipt_uuid=f"academy_receipt_{uuid4()}",
            status="succeeded",
            environment=body.environment,
            operator_instruction=body.operator_instruction,
            release_tag=body.release_tag,
            source_commit=source_commit,
            compiled_digest=body.compiled_digest,
            readback_digest=readback_digest,
            rollback_target=body.rollback_target,
            before_state=previous.after_state if previous is not None else {},
            after_state=body.graph,
        )
        db_session.add(receipt)
        await db_session.commit()
        await db_session.refresh(receipt)
        return AcademyPublicationRead.model_validate(receipt)
    except Exception:
        await db_session.rollback()
        raise


@router.post(
    "/releases/{target_release_tag:path}/rollback",
    response_model=AcademyPublicationRead,
)
async def rollback_academy_release(
    target_release_tag: str,
    body: AcademyRollbackRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> AcademyPublicationRead:
    await _acquire_publication_lock(db_session)

    existing = (
        (
            await db_session.execute(
                select(AcademyPublication).where(
                    AcademyPublication.release_tag == body.release_tag
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        current = (
            (
                await db_session.execute(
                    select(AcademyPublication).order_by(AcademyPublication.id.desc())
                )
            )
            .scalars()
            .first()
        )
        if current is None or current.id != existing.id:
            raise HTTPException(status_code=409, detail="Academy rollback tag is not current")
        organization = await _organization(db_session)
        if existing.after_state:
            projection = AcademyReleaseRequest(
                compiled_digest=existing.compiled_digest,
                graph=existing.after_state,
                operator_instruction=existing.operator_instruction,
                release_tag=existing.release_tag,
                environment=existing.environment,
                rollback_target=existing.rollback_target,
            )
            await verify_readback(projection, db_session, organization)
        else:
            await verify_archived(existing.before_state, db_session, organization)
        return AcademyPublicationRead.model_validate(existing)

    current = (
        (
            await db_session.execute(
                select(AcademyPublication).order_by(AcademyPublication.id.desc())
            )
        )
        .scalars()
        .first()
    )
    if current is None:
        raise HTTPException(status_code=409, detail="Academy has no release to roll back")

    target = (
        (
            await db_session.execute(
                select(AcademyPublication).where(
                    AcademyPublication.release_tag == target_release_tag
                )
            )
        )
        .scalars()
        .first()
    )
    if target is None and target_release_tag != "academy-release/empty":
        raise HTTPException(status_code=404, detail="Academy rollback target was not found")

    organization = await _organization(db_session)
    target_graph = target.after_state if target is not None else {}
    target_digest = target.compiled_digest if target is not None else _canonical_digest({})
    source_commit = target.source_commit if target is not None else current.source_commit
    try:
        await archive_graph(current.after_state, db_session, organization)
        if target is not None:
            projection = AcademyReleaseRequest(
                compiled_digest=target_digest,
                graph=target_graph,
                operator_instruction=body.operator_instruction,
                release_tag=body.release_tag,
                environment=body.environment,
                rollback_target=current.release_tag,
            )
            await project_graph(projection, db_session, organization)
            readback_digest = await verify_readback(
                projection, db_session, organization
            )
        else:
            await verify_archived(current.after_state, db_session, organization)
            readback_digest = target_digest

        receipt = AcademyPublication(
            receipt_uuid=f"academy_receipt_{uuid4()}",
            status="succeeded",
            environment=body.environment,
            operator_instruction=body.operator_instruction,
            release_tag=body.release_tag,
            source_commit=source_commit,
            compiled_digest=target_digest,
            readback_digest=readback_digest,
            rollback_target=current.release_tag,
            before_state=current.after_state,
            after_state=target_graph,
        )
        db_session.add(receipt)
        await db_session.commit()
        await db_session.refresh(receipt)
        return AcademyPublicationRead.model_validate(receipt)
    except Exception:
        await db_session.rollback()
        raise
