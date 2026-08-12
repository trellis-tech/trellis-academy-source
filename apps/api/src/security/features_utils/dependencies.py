"""
FastAPI dependencies for feature flag checks and admin authorization.

These dependencies can be added to routers or individual endpoints
to check if features are enabled before processing requests.
"""
from fastapi import Depends, HTTPException, Path, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.courses.courses import Course
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.rbac.constants import ADMIN_ROLE_ID
from typing import Literal

FeatureName = Literal[
    "courses",
    "folders",
    "usergroups",
]


# ============================================================================
# Admin authorization dependency
# ============================================================================

async def require_org_admin(
    org_id: int = Path(..., description="Organization ID"),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> bool:
    """
    Dependency that verifies the current user is an admin (role_id=1)
    for the specified organization.

    Use this at the router level for endpoints that modify org configuration.

    Raises:
        HTTPException 401: If user is anonymous
        HTTPException 403: If user is not an admin for this org
        HTTPException 404: If organization not found
    """
    # Check for anonymous user
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=401,
            detail="Authentication required to perform this action",
        )

    # Organization API tokens carry scoped resource rights. They must not
    # inherit the administrator authority of the user who created the token.
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=403,
            detail="API tokens cannot modify organization configuration",
        )

    # Verify organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    acting_user_id = resolve_acting_user_id(current_user)

    # Superadmin bypass
    from src.security.superadmin import is_user_superadmin
    if await is_user_superadmin(acting_user_id, db_session):
        return True

    # Check if user is admin in this organization
    statement = (
        select(UserOrganization)
        .where(UserOrganization.user_id == acting_user_id)
        .where(UserOrganization.org_id == org_id)
        .where(UserOrganization.role_id == ADMIN_ROLE_ID)
    )

    user_org = (await db_session.execute(statement)).scalars().first()

    if not user_org:
        raise HTTPException(
            status_code=403,
            detail="Only organization admins can enable or disable features",
        )

    return True


async def _check_feature_enabled(
    feature: FeatureName,
    org_id: int,
    db_session: AsyncSession,
) -> bool:
    """
    Academy release-one learning features are unmetered. Verify that the
    requested feature belongs to the retained surface and that the tenant
    exists; do not consult plans, billing usage, or seat counts.

    Returns:
        True if enabled

    Raises:
        HTTPException 404 if the feature or organization is unavailable
    """
    if feature not in ("courses", "folders", "usergroups"):
        raise HTTPException(status_code=404, detail="Feature not available")

    statement = select(Organization).where(Organization.id == org_id)
    organization = (await db_session.execute(statement)).scalars().first()
    if organization is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )
    return True


# ============================================================================
# Dependencies for endpoints with org_id as path/query parameter
# ============================================================================

async def require_courses_feature_by_org_id(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
) -> bool:
    """
    Dependency that checks if courses feature is enabled.
    Use for endpoints that have org_id as a direct parameter.
    """
    return await _check_feature_enabled("courses", org_id, db_session)


# ============================================================================
# Dependencies for endpoints with org_slug as path parameter
# ============================================================================

async def require_courses_feature_by_org_slug(
    org_slug: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
) -> bool:
    """
    Dependency that checks if courses feature is enabled.
    Use for endpoints that have org_slug as a path parameter.
    """
    statement = select(Organization).where(Organization.slug == org_slug)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    return await _check_feature_enabled("courses", org.id, db_session)


# ============================================================================
# Dependencies for endpoints with course_uuid as path parameter
# ============================================================================

async def require_courses_feature_by_course_uuid(
    course_uuid: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
) -> bool:
    """
    Dependency that checks if courses feature is enabled.
    Use for endpoints that have course_uuid as a path parameter.
    """
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    return await _check_feature_enabled("courses", course.org_id, db_session)


# ============================================================================
# Dependencies for endpoints with activity_uuid as path parameter
# ============================================================================

async def require_courses_feature_by_activity_uuid(
    activity_uuid: str = Path(...),
    db_session: AsyncSession = Depends(get_db_session),
) -> bool:
    """
    Dependency that checks if courses feature is enabled.
    Use for endpoints that have activity_uuid as a path parameter.
    """
    from src.db.courses.activities import Activity

    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = (await db_session.execute(statement)).scalars().first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    statement = select(Course).where(Course.id == activity.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    return await _check_feature_enabled("courses", course.org_id, db_session)


# ============================================================================
# Router-level dependencies (auto-detect parameter type)
# ============================================================================

async def require_courses_feature(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
) -> bool:
    """
    Router-level dependency that auto-detects the parameter type and checks
    if the courses feature is enabled.

    Checks in order: course_uuid, activity_uuid, org_slug, org_id
    If none found, allows the request (for endpoints that don't need the check).
    """
    path_params = request.path_params

    # Try course_uuid first
    if "course_uuid" in path_params:
        course_uuid = path_params["course_uuid"]
        statement = select(Course).where(Course.course_uuid == course_uuid)
        course = (await db_session.execute(statement)).scalars().first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        return await _check_feature_enabled("courses", course.org_id, db_session)

    # Try activity_uuid
    if "activity_uuid" in path_params:
        from src.db.courses.activities import Activity
        activity_uuid = path_params["activity_uuid"]
        statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
        activity = (await db_session.execute(statement)).scalars().first()
        if not activity:
            raise HTTPException(status_code=404, detail="Activity not found")
        statement = select(Course).where(Course.id == activity.course_id)
        course = (await db_session.execute(statement)).scalars().first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        return await _check_feature_enabled("courses", course.org_id, db_session)

    # Try org_slug
    if "org_slug" in path_params:
        org_slug = path_params["org_slug"]
        statement = select(Organization).where(Organization.slug == org_slug)
        org = (await db_session.execute(statement)).scalars().first()
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
        return await _check_feature_enabled("courses", org.id, db_session)

    # Try org_id
    if "org_id" in path_params:
        try:
            org_id = int(path_params["org_id"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid org_id format")
        return await _check_feature_enabled("courses", org_id, db_session)

    # No relevant parameter found, allow the request
    # (for endpoints that don't need the feature check)
    return True
