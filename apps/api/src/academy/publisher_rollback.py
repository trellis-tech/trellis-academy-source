from typing import Any

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.academy.publisher_projection import _assert_owned, _native_ids
from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment
from src.db.courses.courses import Course
from src.db.organizations import Organization


async def archive_graph(
    graph: dict[str, Any],
    db_session: AsyncSession,
    organization: Organization,
) -> None:
    """Hide a repository-managed graph without deleting learning records."""
    native = graph.get("nativeIds")
    if not isinstance(native, dict):
        if graph:
            raise HTTPException(status_code=422, detail="Rollback graph has no native IDs")
        return

    for source_id, native_id in _native_ids(graph, "courses").items():
        course = (
            (
                await db_session.execute(
                    select(Course).where(
                        Course.course_uuid == native_id,
                        Course.org_id == organization.id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if course is None:
            raise HTTPException(status_code=409, detail=f"Rollback course missing: {source_id}")
        _assert_owned(course, source_id)
        course.public = False
        course.published = False
        db_session.add(course)

    for source_id, native_id in _native_ids(graph, "lessons").items():
        activity = (
            (
                await db_session.execute(
                    select(Activity).where(
                        Activity.activity_uuid == native_id,
                        Activity.org_id == organization.id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if activity is None:
            raise HTTPException(status_code=409, detail=f"Rollback activity missing: {source_id}")
        _assert_owned(activity, source_id)
        activity.published = False
        db_session.add(activity)

    for source_id, native_id in _native_ids(graph, "assessments").items():
        assignment = (
            (
                await db_session.execute(
                    select(Assignment).where(
                        Assignment.assignment_uuid == native_id,
                        Assignment.org_id == organization.id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if assignment is None:
            raise HTTPException(status_code=409, detail=f"Rollback assignment missing: {source_id}")
        assignment.published = False
        db_session.add(assignment)

    await db_session.flush()


async def verify_archived(
    graph: dict[str, Any],
    db_session: AsyncSession,
    organization: Organization,
) -> None:
    native = graph.get("nativeIds")
    courses = native.get("courses") if isinstance(native, dict) else {}
    if not isinstance(courses, dict):
        raise HTTPException(status_code=422, detail="Rollback graph has invalid courses")
    for native_id in courses.values():
        course = (
            (
                await db_session.execute(
                    select(Course).where(
                        Course.course_uuid == native_id,
                        Course.org_id == organization.id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if course is None or course.public or course.published:
            raise HTTPException(status_code=500, detail="Academy rollback readback failed")
