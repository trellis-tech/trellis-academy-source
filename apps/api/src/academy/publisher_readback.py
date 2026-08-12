from hashlib import sha256
from typing import Any, Protocol

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.academy.publisher_projection import _assert_owned, _english, _native_ids, _records
from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.organizations import Organization


class AcademyReleaseInput(Protocol):
    compiled_digest: str
    graph: dict[str, Any]


def _fail(detail: str) -> None:
    raise HTTPException(status_code=500, detail=detail)


def _metadata_matches(row: Any, source_id: str, digest: str) -> bool:
    metadata = row.extra_metadata if isinstance(row.extra_metadata, dict) else {}
    return metadata == {
        "academy_source": True,
        "source_id": source_id,
        "compiled_digest": digest,
    }


async def verify_readback(
    body: AcademyReleaseInput,
    db_session: AsyncSession,
    organization: Organization,
) -> str:
    courses = {str(item["id"]): item for item in _records(body.graph, "courses")}
    modules = {str(item["id"]): item for item in _records(body.graph, "modules")}
    lessons = {str(item["id"]): item for item in _records(body.graph, "lessons")}
    assessments = {str(item["id"]): item for item in _records(body.graph, "assessments")}
    ids = {
        key: _native_ids(body.graph, key)
        for key in ("courses", "modules", "lessons", "assessments")
    }

    course_rows: dict[str, Course] = {}
    for source_id, resource in courses.items():
        course = (
            (
                await db_session.execute(
                    select(Course).where(
                        Course.course_uuid == ids["courses"][source_id],
                        Course.org_id == organization.id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if course is None:
            _fail(f"Course readback failed: {source_id}")
        _assert_owned(course, source_id)
        english = _english(resource)
        visible = resource.get("status") == "published"
        if (
            course.name != str(english.get("title", ""))
            or course.description != str(english.get("summary", ""))
            or course.about != str(english.get("summary", ""))
            or course.public is not visible
            or course.published is not visible
            or not _metadata_matches(course, source_id, body.compiled_digest)
        ):
            _fail("Academy course readback mismatch")
        course_rows[source_id] = course

    chapter_rows: dict[str, Chapter] = {}
    for source_id, resource in modules.items():
        course = course_rows[str(resource["courseId"])]
        chapter = (
            (
                await db_session.execute(
                    select(Chapter).where(Chapter.chapter_uuid == ids["modules"][source_id])
                )
            )
            .scalars()
            .first()
        )
        if chapter is None:
            _fail(f"Module readback failed: {source_id}")
        _assert_owned(chapter, source_id)
        link = (
            (
                await db_session.execute(
                    select(CourseChapter).where(
                        CourseChapter.course_id == course.id,
                        CourseChapter.chapter_id == chapter.id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if (
            chapter.course_id != course.id
            or chapter.org_id != organization.id
            or chapter.name != str(_english(resource).get("title", ""))
            or not _metadata_matches(chapter, source_id, body.compiled_digest)
            or link is None
            or link.org_id != organization.id
            or link.order != int(resource.get("order", 0))
        ):
            _fail("Academy module readback mismatch")
        chapter_rows[source_id] = chapter

    activity_rows: dict[str, Activity] = {}
    for source_id, resource in lessons.items():
        chapter = chapter_rows[str(resource["moduleId"])]
        course = next(row for row in course_rows.values() if row.id == chapter.course_id)
        activity = (
            (
                await db_session.execute(
                    select(Activity).where(Activity.activity_uuid == ids["lessons"][source_id])
                )
            )
            .scalars()
            .first()
        )
        if activity is None:
            _fail(f"Lesson readback failed: {source_id}")
        _assert_owned(activity, source_id)
        link = (
            (
                await db_session.execute(
                    select(ChapterActivity).where(
                        ChapterActivity.chapter_id == chapter.id,
                        ChapterActivity.activity_id == activity.id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if (
            activity.course_id != course.id
            or activity.org_id != organization.id
            or activity.name != str(_english(resource).get("title", ""))
            or activity.published is not True
            or not _metadata_matches(activity, source_id, body.compiled_digest)
            or link is None
            or link.course_id != course.id
            or link.org_id != organization.id
            or link.order != int(resource.get("order", 0))
        ):
            _fail("Academy lesson readback mismatch")
        activity_rows[source_id] = activity

    for source_id, resource in assessments.items():
        activity = activity_rows[str(resource["lessonId"])]
        lesson = lessons[str(resource["lessonId"])]
        chapter = chapter_rows[str(lesson["moduleId"])]
        course = next(row for row in course_rows.values() if row.id == activity.course_id)
        assignment = (
            (
                await db_session.execute(
                    select(Assignment).where(
                        Assignment.assignment_uuid == ids["assessments"][source_id]
                    )
                )
            )
            .scalars()
            .first()
        )
        if assignment is None:
            _fail(f"Assessment readback failed: {source_id}")
        task_uuid = f"assignmenttask_{sha256(ids['assessments'][source_id].encode()).hexdigest()[:24]}"
        task = (
            (
                await db_session.execute(
                    select(AssignmentTask).where(
                        AssignmentTask.assignment_task_uuid == task_uuid
                    )
                )
            )
            .scalars()
            .first()
        )
        english = _english(resource)
        expected_options = [
            {
                "optionUUID": str(option.get("id", "")),
                "label": str(option.get("label", "")),
                "assigned_right_answer": option.get("correct") is True,
            }
            for option in english.get("options", [])
            if isinstance(option, dict)
        ]
        expected_contents = {
            "questions": [
                {"questionUUID": "question_platform_readiness", "options": expected_options}
            ]
        }
        parents = (assignment.id, course.id, chapter.id, activity.id)
        if (
            assignment.title != str(english.get("prompt", ""))
            or assignment.description != "Synthetic platform proof only."
            or assignment.org_id != organization.id
            or assignment.published is not True
            or (assignment.id, assignment.course_id, assignment.chapter_id, assignment.activity_id)
            != parents
            or task is None
            or task.title != str(english.get("prompt", ""))
            or task.description != str(english.get("prompt", ""))
            or task.org_id != organization.id
            or (task.assignment_id, task.course_id, task.chapter_id, task.activity_id) != parents
            or task.contents != expected_contents
        ):
            _fail("Academy assessment readback mismatch")

    managed_courses = (
        (
            await db_session.execute(
                select(Course).where(Course.org_id == organization.id)
            )
        )
        .scalars()
        .all()
    )
    expected_ids = set(ids["courses"].values())
    for course in managed_courses:
        metadata = course.extra_metadata if isinstance(course.extra_metadata, dict) else {}
        if (
            metadata.get("academy_source") is True
            and course.course_uuid not in expected_ids
            and (course.public is True or course.published is True)
        ):
            _fail("Omitted Academy course remains visible")
    return body.compiled_digest
