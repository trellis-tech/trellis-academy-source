import logging
from typing import Literal, Optional, Union
from fastapi import HTTPException, status, Request
from sqlalchemy import null
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.db.courses.courses import Course
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, SuperadminAPITokenUser
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.security.rbac.utils import (
    check_element_type,
    check_course_permissions_with_own,
    get_element_organization_id,
)
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.security.superadmin import is_user_superadmin

logger = logging.getLogger(__name__)


async def check_usergroup_access(
    resource_uuid: str,
    user_id: int,
    db_session: AsyncSession,
) -> bool:
    """
    Check if a user has access to a resource via UserGroup membership.

    This checks if:
    1. The resource is linked to any UserGroups
    2. If yes, whether the user is a member of any of those UserGroups

    Args:
        resource_uuid: UUID of the resource (course, podcast, community, etc.)
        user_id: ID of the user to check
        db_session: Database session

    Returns:
        bool: True if user has access (either no UserGroup restrictions or user is a member)
    """
    logger.info("[USERGROUP_ACCESS] Checking access for resource_uuid=%s, user_id=%s", resource_uuid, user_id)

    # Check if resource has any UserGroups linked
    usergroup_stmt = select(UserGroupResource).where(
        UserGroupResource.resource_uuid == resource_uuid
    )
    usergroup_resources = (await db_session.execute(usergroup_stmt)).scalars().all()

    logger.info("[USERGROUP_ACCESS] Found %d UserGroupResource entries for resource", len(usergroup_resources))

    # If no UserGroups are linked, the resource is available only to members
    # of its owning organization. An account in another tenant is not a valid
    # "authenticated users" fallback.
    if not usergroup_resources:
        target_org_id = await get_element_organization_id(resource_uuid, db_session)
        if target_org_id is None:
            logger.warning(
                "[USERGROUP_ACCESS] Cannot resolve org for %s; denying",
                resource_uuid,
            )
            return False
        membership = (
            await db_session.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == user_id,
                    UserOrganization.org_id == target_org_id,
                )
            )
        ).scalars().first()
        return membership is not None

    # Check if user is a member of any linked UserGroup
    usergroup_ids = [ugr.usergroup_id for ugr in usergroup_resources]
    logger.info("[USERGROUP_ACCESS] UserGroup IDs linked to resource: %s", usergroup_ids)

    membership_stmt = select(UserGroupUser).where(
        UserGroupUser.usergroup_id.in_(usergroup_ids),
        UserGroupUser.user_id == user_id
    )
    membership = (await db_session.execute(membership_stmt)).scalars().first()

    if membership:
        logger.info("[USERGROUP_ACCESS] User %s IS a member of UserGroup %s, granting access", user_id, membership.usergroup_id)
    else:
        logger.info("[USERGROUP_ACCESS] User %s is NOT a member of any linked UserGroups %s, denying access", user_id, usergroup_ids)

    return membership is not None


# Tested and working
async def authorization_verify_if_element_is_public(
    request,
    element_uuid: str,
    action: Literal["read"],
    db_session: AsyncSession,
):
    if action != "read":
        raise HTTPException(status_code=403, detail="Access denied")

    from src.db.users import AnonymousUser
    from src.security.rbac.resource_access import ResourceAccessChecker
    from src.security.rbac.types import AccessAction

    decision = await ResourceAccessChecker(
        request, db_session, AnonymousUser()
    ).check_access(element_uuid, AccessAction.READ)
    if decision.allowed:
        return True
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=decision.reason,
    )


# Tested and working
async def authorization_verify_if_user_is_author(
    request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: AsyncSession,
):
    # A resource that does not exist cannot have an author. Creation authority
    # is decided by the role/org checks in the caller, not by authorship.
    if action == "create":
        return False

    if action in ["update", "delete", "read"]:
        # Query for the current user's authorship record specifically
        # FIXED: Previously this only filtered by resource_uuid and got .first(),
        # which would return the first author (usually CREATOR) even if the current
        # user was a different contributor. Now we filter by both resource_uuid AND user_id.
        statement = select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == element_uuid,
            ResourceAuthor.user_id == user_id
        )
        resource_author = (await db_session.execute(statement)).scalars().first()

        if resource_author:
            valid_authorships = [
                ResourceAuthorshipEnum.CREATOR,
                ResourceAuthorshipEnum.MAINTAINER,
                ResourceAuthorshipEnum.CONTRIBUTOR,
            ]
            if (resource_author.authorship in valid_authorships and
                    resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE):
                return True
            else:
                return False
        else:
            return False
    return False


async def _load_applicable_roles(
    db_session: AsyncSession,
    user_id: int,
    target_org_id: int | None,
):
    """
    Load roles that may grant a user permission on a resource in ``target_org_id``.

    A role applies when either (a) it belongs to the target organization and the
    user holds it there, or (b) it is a global default role (``org_id IS NULL``)
    and the user is a member of the target organization. When ``target_org_id``
    is ``None`` (placeholder UUIDs used during top-level creation), every role
    the user holds is returned — existence checks and org-scoped request bodies
    gate those paths downstream.
    """
    if target_org_id is None:
        statement = (
            select(Role)
            .join(UserOrganization, UserOrganization.role_id == Role.id)
            .where(
                (UserOrganization.org_id == Role.org_id)
                | (Role.org_id == null())
            )
            .where(UserOrganization.user_id == user_id)
        )
        return (await db_session.execute(statement)).scalars().all()

    is_member_of_target = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == target_org_id,
        )
    )).scalars().first()

    if not is_member_of_target:
        # Non-member: never grant role-based access to this org's resources.
        return []

    statement = (
        select(Role)
        .join(UserOrganization, UserOrganization.role_id == Role.id)
        .where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == target_org_id,
        )
        .where((Role.org_id == target_org_id) | (Role.org_id == null()))
    )
    return (await db_session.execute(statement)).scalars().all()


async def _shared_org_ids_with_target_user(
    db_session: AsyncSession,
    user_id: int,
    target_user_uuid: str,
) -> list[int] | None:
    """Org ids where both the caller and the targeted user are members.

    Returns ``None`` when ``target_user_uuid`` names no real user — the create
    paths pass a placeholder (``user_x``), which has no target to be scoped
    against and is gated by the endpoint instead.
    """
    from src.db.users import User

    target_id = (
        await db_session.execute(
            select(User.id).where(User.user_uuid == target_user_uuid)
        )
    ).scalars().first()
    if target_id is None:
        return None

    caller_orgs = set(
        (
            await db_session.execute(
                select(UserOrganization.org_id).where(UserOrganization.user_id == user_id)
            )
        ).scalars().all()
    )
    target_orgs = set(
        (
            await db_session.execute(
                select(UserOrganization.org_id).where(UserOrganization.user_id == target_id)
            )
        ).scalars().all()
    )
    return sorted(caller_orgs & target_orgs)


async def _load_roles_for_user_target(
    db_session: AsyncSession,
    user_id: int,
    shared_org_ids: list[int],
):
    """Roles that may act on a user account, scoped to shared organizations.

    A user row carries no org of its own, so the generic resolver answers None
    for it. Loading *every* role the caller holds there would let an admin of one
    organization update or delete an account that only belongs to another.
    """
    statement = (
        select(Role)
        .join(UserOrganization, UserOrganization.role_id == Role.id)
        .where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id.in_(shared_org_ids),  # type: ignore[union-attr]
        )
        .where(Role.org_id.in_(shared_org_ids) | (Role.org_id == null()))  # type: ignore[union-attr]
    )
    return (await db_session.execute(statement)).scalars().all()


# Tested and working
async def authorization_verify_based_on_roles(
    request: Request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: AsyncSession,
    target_org_id_override: int | None = None,
):
    # Superadmin bypass - full access to all resources
    if await is_user_superadmin(user_id, db_session):
        return True

    element_type = await check_element_type(element_uuid)

    # SECURITY: role-based fallback must be scoped to the target resource's org.
    # Without this check, a user with e.g. admin-in-orgA whose admin role grants
    # courses.action_update=True could mutate a course in orgB purely because
    # one of their org roles carries the permission.
    target_org_id = target_org_id_override
    if target_org_id is None:
        target_org_id = await get_element_organization_id(element_uuid, db_session)

    # Placeholder UUIDs represent a resource that does not exist yet, so no
    # organization can be derived from the database. Never fall back to a role
    # the caller holds in an arbitrary tenant; every top-level create must pass
    # the organization named by its request body/path/query explicitly.
    if action == "create" and element_uuid.endswith("_x") and target_org_id is None:
        return False

    if element_type == "users" and target_org_id is None:
        # A user row has no org column, so the generic resolver returns None and
        # the placeholder branch below would hand back every role the caller
        # holds anywhere — letting an admin of one org act on an account that
        # only belongs to another. Scope to the orgs the two actually share.
        shared_org_ids = await _shared_org_ids_with_target_user(
            db_session, user_id, element_uuid
        )
        if shared_org_ids is not None:
            if not shared_org_ids:
                return False
            user_roles_in_organization_and_standard_roles = await _load_roles_for_user_target(
                db_session, user_id, shared_org_ids
            )
        else:
            user_roles_in_organization_and_standard_roles = await _load_applicable_roles(
                db_session, user_id, target_org_id
            )
    else:
        user_roles_in_organization_and_standard_roles = await _load_applicable_roles(
            db_session, user_id, target_org_id
        )


    # Check if user is the author of the resource for "own" permissions
    is_author = False
    if action in ["update", "delete", "read"]:
        is_author = await authorization_verify_if_user_is_author(
            request, user_id, action, element_uuid, db_session
        )

    # Check all roles until we find one that grants the permission
    for role in user_roles_in_organization_and_standard_roles:
        role = Role.model_validate(role)
        if role.rights:
            rights = role.rights
            # Handle both dict (from JSON storage) and Rights object
            if isinstance(rights, dict):
                element_rights = rights.get(element_type)
            else:
                element_rights = getattr(rights, element_type, None)
            if element_rights:
                # Special handling for resources with PermissionsWithOwn
                if element_type in ("courses", "discussions", "podcasts", "boards", "playgrounds"):
                    if await check_course_permissions_with_own(element_rights, action, is_author):
                        return True
                else:
                    # For non-course resources, only check general permissions
                    # Handle both dict and object access
                    if isinstance(element_rights, dict):
                        if element_rights.get(f"action_{action}", False):
                            return True
                    elif getattr(element_rights, f"action_{action}", False):
                        return True

    # If we get here, no role granted the permission
    return False


async def authorization_verify_based_on_org_admin_status(
    request: Request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: AsyncSession,
    target_org_id_override: int | None = None,
):
    """
    Verify if a user has admin status in the SPECIFIC organization being accessed.

    Args:
        request: FastAPI request object
        user_id: ID of the user to check
        action: The action being performed (read, update, delete, create)
        element_uuid: UUID of the element (organization) being accessed
        db_session: Database session

    Returns:
        bool: True if user is admin in the target organization, False otherwise
    """
    # Superadmin bypass - full access to all organizations
    if await is_user_superadmin(user_id, db_session):
        return True

    # Get the target organization's ID from the element UUID
    target_org_id = target_org_id_override
    if target_org_id is None:
        target_org_id = await get_element_organization_id(element_uuid, db_session)

    if target_org_id is None:
        # If we can't determine the organization, deny access for safety
        return False

    # Check if user has admin or maintainer role in the TARGET organization
    # Note: This checks for admin/maintainer role which typically have full permissions
    statement = (
        select(UserOrganization)
        .where(UserOrganization.user_id == user_id)
        .where(UserOrganization.org_id == target_org_id)
        .where(UserOrganization.role_id.in_(ADMIN_OR_MAINTAINER_ROLE_IDS))
    )

    user_org = (await db_session.execute(statement)).scalars().first()

    return user_org is not None


# Tested and working
async def authorization_verify_based_on_roles_and_authorship(
    request: Request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: AsyncSession,
):
    logger.info("[RBAC] authorization_verify_based_on_roles_and_authorship: user_id=%s, action=%s, element_uuid=%s", user_id, action, element_uuid)

    # Superadmin bypass - full access to all resources
    if await is_user_superadmin(user_id, db_session):
        logger.info("[RBAC] Superadmin bypass for user_id=%s", user_id)
        return True

    isAuthor = await authorization_verify_if_user_is_author(
        request, user_id, action, element_uuid, db_session
    )
    logger.info("[RBAC] isAuthor=%s", isAuthor)

    isRole = await authorization_verify_based_on_roles(
        request, user_id, action, element_uuid, db_session
    )
    logger.info("[RBAC] isRole=%s", isRole)

    # Authors and role-holders (e.g. course admins/maintainers) retain access to
    # resources they own or manage regardless of learner UserGroup membership.
    if isAuthor or isRole:
        logger.info("[RBAC] Access GRANTED via author/role before usergroup check")
        return True

    hasUserGroupAccess = False
    if action == "read":
        if not await _is_published_for_learner(element_uuid, db_session):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unpublished resources are not available to learners",
            )
        hasUserGroupAccess = await check_usergroup_access(
            element_uuid, user_id, db_session
        )
    logger.info("[RBAC] hasUserGroupAccess=%s", hasUserGroupAccess)

    if isAuthor or isRole or hasUserGroupAccess:
        logger.info("[RBAC] Access GRANTED (isAuthor=%s, isRole=%s, hasUserGroupAccess=%s)", isAuthor, isRole, hasUserGroupAccess)
        return True
    else:
        logger.info("[RBAC] Access DENIED (isAuthor=%s, isRole=%s, hasUserGroupAccess=%s)", isAuthor, isRole, hasUserGroupAccess)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User rights (roles & authorship) : You don't have the right to perform this action",
        )


async def _is_published_for_learner(
    element_uuid: str,
    db_session: AsyncSession,
) -> bool:
    element_type = await check_element_type(element_uuid)
    if element_type == "courses":
        published = await db_session.execute(
            select(Course.published).where(Course.course_uuid == element_uuid)
        )
        return bool(published.scalars().first())
    if element_type == "podcasts":
        from src.db.podcasts.podcasts import Podcast

        published = await db_session.execute(
            select(Podcast.published).where(Podcast.podcast_uuid == element_uuid)
        )
        return bool(published.scalars().first())
    return True


async def authorization_verify_if_user_is_anon(user_id: int):
    if user_id == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You should be logged in to perform this action",
        )


async def authorization_verify_api_token_permissions(
    request: Request,
    api_token_user: APITokenUser,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: AsyncSession,
    resource_type_override: Optional[str] = None,
) -> bool:
    """
    Verify API token permissions for an action on an element.

    CRITICAL: This function enforces organization boundary - tokens can ONLY
    access resources within their organization.

    API tokens are restricted to these resources:
    - courses, activities, coursechapters, folders, media, certifications,
    - usergroups, payments, search, assignments

    Args:
        request: FastAPI request object
        api_token_user: The authenticated API token user
        action: The action being performed
        element_uuid: The UUID of the element being accessed. Used both to
            resolve the resource type (by UUID prefix) and to enforce the org
            boundary.
        db_session: Database session
        resource_type_override: When the rights bucket to check differs from the
            element's own type, pass it here. Assignments authorize against their
            parent course UUID (for the org-boundary lookup) but must be checked
            against the ``assignments`` rights bucket, not ``courses``.

    Returns:
        bool: True if permission granted

    Raises:
        HTTPException: If permission denied or org boundary violated
    """
    element_type = resource_type_override or await check_element_type(element_uuid)

    # API tokens are restricted to specific resource types
    allowed_resource_types = [
        'courses', 'activities', 'coursechapters', 'folders', 'media',
        'certifications', 'usergroups', 'search', 'assignments'
    ]

    if element_type not in allowed_resource_types:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API tokens cannot access '{element_type}' resources",
        )

    # CRITICAL: Verify element belongs to token's organization
    element_org_id = await get_element_organization_id(element_uuid, db_session)

    if element_org_id is None or element_org_id != api_token_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "API token resource organization could not be resolved or is "
                "outside the token organization"
            ),
        )

    # Check token's rights for this action
    if not api_token_user.rights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token has no permissions configured",
        )

    # Get the rights for this element type
    rights = api_token_user.rights
    if isinstance(rights, dict):
        element_rights = rights.get(element_type, {})
    else:
        element_rights = getattr(rights, element_type, None)

    if not element_rights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API token does not have permissions for {element_type}",
        )

    # Check the specific action permission
    if element_type == "search":
        # Search only allows read action
        if action != "read":
            has_permission = False
        elif isinstance(element_rights, dict):
            has_permission = element_rights.get("action_read", False)
        else:
            has_permission = getattr(element_rights, "action_read", False)
    elif element_type == "courses":
        # For courses, check standard permission (no "own" for API tokens)
        if isinstance(element_rights, dict):
            has_permission = element_rights.get(f"action_{action}", False)
        else:
            has_permission = getattr(element_rights, f"action_{action}", False)
    else:
        # Standard permission check
        if isinstance(element_rights, dict):
            has_permission = element_rights.get(f"action_{action}", False)
        else:
            has_permission = getattr(element_rights, f"action_{action}", False)

    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API token does not have '{action}' permission for {element_type}",
        )

    return True


async def authorization_verify_based_on_roles_and_authorship_or_api_token(
    request: Request,
    current_user: Union[APITokenUser, any],
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: AsyncSession,
):
    """
    Combined authorization check that handles both regular users and API tokens.

    For API tokens: Verifies org boundary and token permissions
    For regular users: Falls back to existing role/authorship verification
    """
    # Check if this is an API token request
    if isinstance(current_user, APITokenUser):
        return await authorization_verify_api_token_permissions(
            request, current_user, action, element_uuid, db_session
        )

    if isinstance(current_user, SuperadminAPITokenUser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin API tokens cannot access learner resources",
        )

    # Superadmin bypass - full access to all resources
    if await is_user_superadmin(current_user.id, db_session):
        return True

    # Regular user path: use existing logic
    return await authorization_verify_based_on_roles_and_authorship(
        request, current_user.id, action, element_uuid, db_session
    )
