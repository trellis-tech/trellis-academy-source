"""Public immutable release identity for deployment verification."""

import os

from fastapi import APIRouter
from pydantic import BaseModel


class AcademyRelease(BaseModel):
    revision: str
    migration_head: str
    source_url: str | None


router = APIRouter()


@router.get("", response_model=AcademyRelease)
async def get_academy_release() -> AcademyRelease:
    return AcademyRelease(
        revision=os.environ.get("TRELLIS_ACADEMY_RELEASE_SHA", "development"),
        migration_head=os.environ.get("TRELLIS_ACADEMY_MIGRATION_HEAD", "unknown"),
        source_url=os.environ.get("TRELLIS_ACADEMY_SOURCE_URL"),
    )
