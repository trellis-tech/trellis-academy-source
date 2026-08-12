"""Authenticated learner session projection for the Academy web client."""

from fastapi import APIRouter, Depends
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organizations import Organization, OrganizationRead
from src.db.roles import Role, RoleRead
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, UserRoleWithOrg, UserSession
from src.security.api_token_utils import get_authenticated_non_api_token_user


router = APIRouter()


@router.get("/session", response_model=UserSession)
async def get_academy_session(
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> UserSession:
    memberships = (
        await db_session.execute(
            select(Role, Organization)
            .join(UserOrganization, UserOrganization.role_id == Role.id)
            .join(Organization, Organization.id == UserOrganization.org_id)
            .where(UserOrganization.user_id == current_user.id)
        )
    ).all()
    return UserSession(
        user=current_user,
        roles=[
            UserRoleWithOrg(
                role=RoleRead.model_validate(role),
                org=OrganizationRead.model_validate(organization),
            )
            for role, organization in memberships
        ],
    )
