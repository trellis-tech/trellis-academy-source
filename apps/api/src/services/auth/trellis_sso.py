import logging
import os
from datetime import datetime, timezone
from typing import Literal, Optional, Protocol
from uuid import UUID

import httpx
import jwt
from fastapi import HTTPException
from jwt.exceptions import PyJWTError
from pydantic import BaseModel, EmailStr, ValidationError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.roles import Role
from src.db.trellis_identities import TrellisIdentity
from src.db.user_organizations import UserOrganization
from src.db.users import User, UserRead

logger = logging.getLogger(__name__)

TRELLIS_SSO_ISSUER = "trellis-app"
TRELLIS_SSO_AUDIENCE = "trellis-academy"
ACADEMY_ROLE_CLAIM = "academy_role"
AcademyRole = Literal["owner", "learner"]


class ReplayStore(Protocol):
    def set(self, key: str, value: str, *, nx: bool, ex: int) -> object: ...


class TrellisAssertionClaims(BaseModel):
    subject: str
    email: EmailStr
    name: str
    avatar_url: Optional[str] = None
    destination: str = "/"


class TrellisSubjectStatus(BaseModel):
    active: bool
    email: Optional[EmailStr] = None


def _shared_secret() -> str:
    secret = os.environ.get("TRELLIS_ACADEMY_SSO_SECRET", "")
    if not secret:
        logger.error("Trellis Academy SSO secret is not configured")
        raise HTTPException(status_code=503, detail="Trellis SSO is unavailable")
    return secret


def _allowed_emails() -> set[str]:
    emails = {
        email.strip().lower()
        for email in os.environ.get("TRELLIS_ACADEMY_ALLOWED_EMAILS", "").split(",")
        if email.strip()
    }
    if not emails:
        logger.error("Trellis Academy email allowlist is not configured")
        raise HTTPException(status_code=503, detail="Trellis SSO is unavailable")
    return emails


def academy_role_for_email(email: str) -> AcademyRole:
    """Resolve Academy authority without granting upstream CMS permissions."""
    allowed_emails = _allowed_emails()
    owner_emails = {
        owner.strip().lower()
        for owner in os.environ.get("TRELLIS_ACADEMY_OWNER_EMAILS", "").split(",")
        if owner.strip()
    }
    if not owner_emails.issubset(allowed_emails):
        logger.error("Trellis Academy owner allowlist is misconfigured")
        raise HTTPException(status_code=503, detail="Trellis SSO is unavailable")
    normalized_email = email.strip().lower()
    if normalized_email not in allowed_emails:
        raise HTTPException(status_code=403, detail="Trellis Academy access is unavailable")
    return "owner" if normalized_email in owner_emails else "learner"


def verify_and_consume_assertion(
    assertion: str,
    redis_client: Optional[ReplayStore],
) -> TrellisAssertionClaims:
    try:
        payload = jwt.decode(
            assertion,
            _shared_secret(),
            algorithms=["HS256"],
            issuer=TRELLIS_SSO_ISSUER,
            audience=TRELLIS_SSO_AUDIENCE,
            options={"require": ["iss", "aud", "sub", "jti", "iat", "exp", "email"]},
        )
        UUID(str(payload["sub"]))
        claims = TrellisAssertionClaims(
            subject=str(payload["sub"]),
            email=payload["email"],
            name=str(payload.get("name") or payload["email"]),
            avatar_url=payload.get("avatar_url"),
            destination=str(payload.get("destination") or "/"),
        )
        jti = str(payload["jti"])
        expires_at = int(payload["exp"])
    except (KeyError, PyJWTError, ValidationError, ValueError, TypeError):
        raise HTTPException(
            status_code=401, detail="Invalid Trellis SSO assertion"
        ) from None

    if str(claims.email).strip().lower() not in _allowed_emails():
        raise HTTPException(status_code=403, detail="Academy access is restricted")

    if redis_client is None:
        logger.error("Trellis Academy SSO replay store is unavailable")
        raise HTTPException(status_code=503, detail="Trellis SSO is unavailable")

    ttl_seconds = max(1, expires_at - int(datetime.now(timezone.utc).timestamp()) + 60)
    try:
        consumed = redis_client.set(
            f"trellis_sso_used:{jti}",
            "1",
            nx=True,
            ex=ttl_seconds,
        )
    except Exception:
        logger.exception("Trellis Academy SSO replay check failed")
        raise HTTPException(
            status_code=503, detail="Trellis SSO is unavailable"
        ) from None

    if not consumed:
        raise HTTPException(
            status_code=410, detail="Trellis SSO assertion already used"
        )

    return claims


def _profile_name(name: str) -> tuple[str, str]:
    parts = name.strip().split(maxsplit=1)
    if not parts:
        return "Trellis", "Learner"
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


async def provision_trellis_learner(
    claims: TrellisAssertionClaims,
    db_session: AsyncSession,
    *,
    org_slug: str,
) -> UserRead:
    organization = (
        (
            await db_session.execute(
                select(Organization).where(Organization.slug == org_slug)
            )
        )
        .scalars()
        .first()
    )
    if organization is None or organization.id is None:
        raise HTTPException(
            status_code=503, detail="Trellis Academy organization is unavailable"
        )

    learner_role = (
        (await db_session.execute(select(Role).where(Role.id == 4))).scalars().first()
    )
    if learner_role is None:
        raise HTTPException(
            status_code=503, detail="Trellis Academy learner role is unavailable"
        )

    identity = (
        (
            await db_session.execute(
                select(TrellisIdentity).where(
                    TrellisIdentity.trellis_subject == claims.subject
                )
            )
        )
        .scalars()
        .first()
    )

    if identity is None:
        email_owner = (
            (
                await db_session.execute(
                    select(User).where(User.email == str(claims.email))
                )
            )
            .scalars()
            .first()
        )
        if email_owner is not None:
            raise HTTPException(status_code=409, detail="Academy identity collision")

        first_name, last_name = _profile_name(claims.name)
        now = datetime.now(timezone.utc)
        user = User(
            username=f"trellis_{claims.subject.replace('-', '')}",
            first_name=first_name,
            last_name=last_name,
            email=str(claims.email),
            avatar_image=claims.avatar_url or "",
            password="",
            user_uuid=f"user_{claims.subject}",
            email_verified=True,
            email_verified_at=now.isoformat(),
            signup_method="trellis_sso",
            creation_date=str(now),
            update_date=str(now),
        )
        db_session.add(user)
        await db_session.flush()
        if user.id is None:
            raise HTTPException(
                status_code=503, detail="Academy learner provisioning failed"
            )
        identity = TrellisIdentity(
            trellis_subject=claims.subject,
            user_id=user.id,
            created_at=now,
            last_synced_at=now,
        )
        db_session.add(identity)
    else:
        user = (
            (await db_session.execute(select(User).where(User.id == identity.user_id)))
            .scalars()
            .first()
        )
        if user is None:
            raise HTTPException(
                status_code=503, detail="Academy identity mapping is invalid"
            )
        email_owner = (
            (
                await db_session.execute(
                    select(User).where(
                        User.email == str(claims.email), User.id != user.id
                    )
                )
            )
            .scalars()
            .first()
        )
        if email_owner is not None:
            raise HTTPException(status_code=409, detail="Academy identity collision")
        first_name, last_name = _profile_name(claims.name)
        user.email = str(claims.email)
        user.first_name = first_name
        user.last_name = last_name
        user.avatar_image = claims.avatar_url or ""
        user.update_date = str(datetime.now(timezone.utc))
        identity.last_synced_at = datetime.now(timezone.utc)
        db_session.add(user)
        db_session.add(identity)

    membership = (
        (
            await db_session.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == user.id,
                    UserOrganization.org_id == organization.id,
                )
            )
        )
        .scalars()
        .first()
    )
    now_text = str(datetime.now(timezone.utc))
    if membership is None:
        db_session.add(
            UserOrganization(
                user_id=user.id or 0,
                org_id=organization.id,
                role_id=4,
                creation_date=now_text,
                update_date=now_text,
            )
        )
    else:
        membership.role_id = 4
        membership.update_date = now_text
        db_session.add(membership)

    await db_session.commit()
    await db_session.refresh(user)
    return UserRead.model_validate(user)


async def introspect_trellis_identity(subject: str) -> TrellisSubjectStatus:
    app_url = os.environ.get("TRELLIS_APP_URL", "").strip().rstrip("/")
    secret = os.environ.get("TRELLIS_ACADEMY_SSO_SECRET", "")
    if not app_url or not secret:
        logger.error("Trellis Academy introspection is not configured")
        raise HTTPException(status_code=503, detail="Trellis SSO is unavailable")

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                f"{app_url}/api/academy/sso/introspect",
                headers={"Authorization": f"Bearer {secret}"},
                json={"subject": subject},
            )
    except httpx.HTTPError:
        logger.exception("Trellis Academy introspection request failed")
        raise HTTPException(
            status_code=503, detail="Trellis SSO is unavailable"
        ) from None

    if response.status_code != 200:
        logger.error(
            "Trellis Academy introspection returned status %s", response.status_code
        )
        raise HTTPException(status_code=503, detail="Trellis SSO is unavailable")
    try:
        payload = response.json()
    except ValueError:
        raise HTTPException(
            status_code=503, detail="Trellis SSO is unavailable"
        ) from None
    try:
        status = TrellisSubjectStatus.model_validate(payload)
    except ValidationError:
        raise HTTPException(
            status_code=503, detail="Trellis SSO is unavailable"
        ) from None
    if status.active and status.email is None:
        raise HTTPException(status_code=503, detail="Trellis SSO is unavailable")
    return status


async def introspect_trellis_subject(subject: str) -> bool:
    return (await introspect_trellis_identity(subject)).active
