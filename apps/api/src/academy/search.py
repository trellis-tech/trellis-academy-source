"""Course-and-folder-only search for the Academy release runtime."""

from typing import Union

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.courses import CourseRead
from src.db.folders.folders import Folder, FolderRead
from src.db.organizations import Organization
from src.db.users import APITokenUser, AnonymousUser, PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.org_auth import is_org_member
from src.services.courses.courses import search_courses
from src.services.search.normalization import build_like_pattern
from src.services.security.rate_limiting import (
    check_rate_limit,
    check_search_rate_limit,
    get_client_ip,
)


class AcademySearchResult(BaseModel):
    courses: list[CourseRead]
    folders: list[FolderRead]
    total_courses: int = 0
    total_folders: int = 0


router = APIRouter()


def _empty_result() -> AcademySearchResult:
    return AcademySearchResult(courses=[], folders=[])


def _token_can_search(current_user: APITokenUser) -> bool:
    if not current_user.rights:
        return True
    if isinstance(current_user.rights, dict):
        return bool(current_user.rights.get("search", {}).get("action_read", False))
    search_rights = getattr(current_user.rights, "search", None)
    return bool(search_rights and getattr(search_rights, "action_read", False))


async def search_academy_content(
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    org_slug: str,
    search_query: str,
    db_session: AsyncSession,
    page: int = 1,
    limit: int = 10,
) -> AcademySearchResult:
    limit = min(limit, 50)
    org = (
        await db_session.execute(select(Organization).where(Organization.slug == org_slug))
    ).scalars().first()
    if not org:
        return _empty_result()

    if isinstance(current_user, APITokenUser):
        if current_user.org_id != org.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token cannot search in organizations outside its scope",
            )
        if not _token_can_search(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token does not have search permission",
            )

    acting_user_id = resolve_acting_user_id(current_user)
    member = bool(
        acting_user_id and await is_org_member(acting_user_id, org.id, db_session)
    )
    courses = await search_courses(
        request, current_user, org_slug, search_query, db_session, page, limit
    )

    pattern = build_like_pattern(search_query)
    folders_query = (
        select(Folder)
        .where(Folder.org_id == org.id)
        .where(
            or_(
                Folder.name.ilike(pattern, escape="\\"),
                Folder.description.ilike(pattern, escape="\\"),
            )
        )
    )
    if not member:
        folders_query = folders_query.where(Folder.public.is_(True))

    offset = (page - 1) * limit
    folders = (
        await db_session.execute(folders_query.offset(offset).limit(limit))
    ).scalars().all()
    total_folders = (
        await db_session.execute(
            select(func.count()).select_from(folders_query.order_by(None).subquery())
        )
    ).scalar_one()

    return AcademySearchResult(
        courses=courses,
        folders=[FolderRead.model_validate(folder) for folder in folders],
        total_courses=len(courses),
        total_folders=int(total_folders),
    )


@router.get("/org_slug/{org_slug}", response_model=AcademySearchResult)
async def api_search_academy_content(
    request: Request,
    org_slug: str,
    query: str = Query(..., min_length=3, max_length=200),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=50),
    db_session: AsyncSession = Depends(get_db_session),
    current_user: Union[PublicUser, APITokenUser] = Depends(get_current_user),
) -> AcademySearchResult:
    caller_id = resolve_acting_user_id(current_user)
    if caller_id:
        is_allowed, retry_after = check_search_rate_limit(caller_id)
    else:
        is_allowed, _count, retry_after = check_rate_limit(
            key=f"search_anon:{get_client_ip(request)}",
            max_attempts=30,
            window_seconds=60,
        )
    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many search queries. Please slow down.",
            headers={"Retry-After": str(retry_after)},
        )

    return await search_academy_content(
        request,
        current_user,
        org_slug,
        query,
        db_session,
        page,
        limit,
    )
