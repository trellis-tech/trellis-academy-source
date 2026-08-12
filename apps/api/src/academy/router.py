"""Explicit FastAPI route composition for the Academy launch surface."""

from fastapi import APIRouter, Depends

from src.academy import organizations
from src.academy import publisher
from src.academy import release
from src.academy import search
from src.academy import sessions
from src.academy import trellis_auth
from src.routers import health, stream, trail
from src.routers.courses import assignments, certifications, chapters, courses
from src.routers.courses.activities import activities, blocks
from src.routers.folders import folders
from src.routers.media import media
from src.security.api_token_utils import (
    get_authenticated_non_api_token_user,
    require_authenticated_user_or_api_token,
)


def _only_routes(source: APIRouter, included_names: set[str]) -> APIRouter:
    """Copy only explicitly approved release-one routes from a retained router."""
    return APIRouter(
        routes=[route for route in source.routes if route.name in included_names]
    )


academy_v1_router = APIRouter(prefix="/api/v1")

academy_v1_router.include_router(health.router, prefix="/health", tags=["health"])
academy_v1_router.include_router(release.router, prefix="/release", tags=["release"])
academy_v1_router.include_router(
    trellis_auth.router,
    prefix="/auth/trellis",
    tags=["trellis-auth"],
)
academy_v1_router.include_router(
    publisher.router,
    prefix="/publisher",
    tags=["publisher"],
    dependencies=[Depends(publisher.require_publisher_principal)],
)
academy_v1_router.include_router(
    _only_routes(
        courses.router,
        {
            "api_create_course",
            "api_get_course",
            "api_get_course_by_id",
            "api_get_course_meta",
            "api_get_course_by_orgslug",
            "api_get_courses_count",
            "api_search_courses",
            "api_get_course_updates",
            "api_get_course_contributors",
            "api_get_course_user_rights",
        },
    ),
    prefix="/courses",
    tags=["courses"],
)
academy_v1_router.include_router(
    _only_routes(
        chapters.router,
        {
            "api_create_coursechapter",
            "api_get_coursechapter",
            "api_get_chapter_meta",
            "api_update_chapter_meta",
            "api_get_chapter_by",
            "api_update_coursechapter",
            "api_delete_coursechapter",
        },
    ),
    prefix="/chapters",
    tags=["chapters"],
)
academy_v1_router.include_router(
    _only_routes(
        activities.router,
        {
            route.name
            for route in activities.router.routes
            if route.name
            not in {
                "api_configure_video_captions",
                "api_list_activity_usergroups",
                "api_add_activity_usergroup",
                "api_remove_activity_usergroup",
            }
        },
    ),
    prefix="/activities",
    tags=["activities"],
)
academy_v1_router.include_router(blocks.router, prefix="/blocks", tags=["blocks"])
academy_v1_router.include_router(
    assignments.router,
    prefix="/assignments",
    tags=["assignments"],
    dependencies=[Depends(require_authenticated_user_or_api_token)],
)
academy_v1_router.include_router(
    certifications.router,
    prefix="/certifications",
    tags=["certifications"],
)
academy_v1_router.include_router(
    _only_routes(
        folders.router,
        {
            "api_get_folder",
            "api_get_folders_by",
            "api_search_library",
            "api_get_org_root_items",
        },
    ),
    prefix="/folders",
    tags=["folders"],
)
academy_v1_router.include_router(
    _only_routes(
        media.router,
        {
            "api_serve_media_file",
            "api_head_media_file",
            "api_serve_shared_media",
            "api_head_shared_media",
            "api_get_media",
            "api_get_media_list",
        },
    ),
    prefix="/media",
    tags=["media"],
)
academy_v1_router.include_router(
    trail.router,
    prefix="/trail",
    tags=["trail"],
    dependencies=[Depends(get_authenticated_non_api_token_user)],
)
academy_v1_router.include_router(search.router, prefix="/search", tags=["search"])
academy_v1_router.include_router(
    organizations.router,
    prefix="/orgs",
    tags=["organizations"],
)
academy_v1_router.include_router(sessions.router, prefix="/users", tags=["users"])
academy_v1_router.include_router(stream.router, prefix="/stream", tags=["stream"])
