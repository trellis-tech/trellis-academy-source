"""Read-only organization context required by Academy learner pages."""

import os

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization, OrganizationRead


router = APIRouter()


@router.get("/slug/{org_slug}", response_model=OrganizationRead)
async def get_academy_organization(
    org_slug: str,
    db_session: AsyncSession = Depends(get_db_session),
) -> OrganizationRead:
    configured_slug = os.environ.get("TRELLIS_ACADEMY_ORG_SLUG", "").strip()
    if not configured_slug or org_slug != configured_slug:
        raise HTTPException(status_code=404, detail="Organization not found")

    organization = (
        (
            await db_session.execute(
                select(Organization).where(Organization.slug == configured_slug)
            )
        )
        .scalars()
        .first()
    )
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    stored_config = (
        (
            await db_session.execute(
                select(OrganizationConfig).where(
                    OrganizationConfig.org_id == organization.id
                )
            )
        )
        .scalars()
        .first()
    )
    public_config = None
    if stored_config is not None:
        public_config = OrganizationConfig(
            id=stored_config.id,
            org_id=stored_config.org_id,
            config={
                "active": stored_config.config.get("active", True),
                "customization": stored_config.config.get("customization", {}),
            },
            creation_date=stored_config.creation_date,
            update_date=stored_config.update_date,
        )

    return OrganizationRead(
        **organization.model_dump(),
        config=public_config,
    )
