from hashlib import sha256
from datetime import datetime, timezone
from typing import Any, Protocol

from fastapi import HTTPException
from sqlalchemy import delete
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivityLockType, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, LockType
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.organizations import Organization


class AcademyReleaseInput(Protocol):
    compiled_digest: str
    graph: dict[str, Any]


def _records(graph: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = graph.get(key)
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise HTTPException(status_code=422, detail=f"Compiled graph has invalid {key}")
    return value


def _native_ids(graph: dict[str, Any], key: str) -> dict[str, str]:
    native = graph.get("nativeIds")
    value = native.get(key) if isinstance(native, dict) else None
    if not isinstance(value, dict) or not all(
        isinstance(source_id, str) and isinstance(native_id, str)
        for source_id, native_id in value.items()
    ):
        raise HTTPException(status_code=422, detail=f"Compiled graph has invalid {key} native IDs")
    return value


def _english(resource: dict[str, Any]) -> dict[str, Any]:
    locales = resource.get("locales")
    english = locales.get("en") if isinstance(locales, dict) else None
    if not isinstance(english, dict):
        raise HTTPException(
            status_code=422,
            detail=f"Compiled resource {resource.get('id')} has no English projection",
        )
    return english


def _source_metadata(source_id: str, digest: str) -> dict[str, Any]:
    return {
        "academy_source": True,
        "source_id": source_id,
        "compiled_digest": digest,
    }


def _assert_owned(existing: Any, source_id: str) -> None:
    metadata = existing.extra_metadata if isinstance(existing.extra_metadata, dict) else {}
    if metadata.get("academy_source") is not True or metadata.get("source_id") != source_id:
        raise HTTPException(status_code=409, detail="Academy native identifier collision")


async def _upsert_course(
    db_session: AsyncSession,
    organization: Organization,
    resource: dict[str, Any],
    native_id: str,
    digest: str,
    now: str,
) -> Course:
    source_id = str(resource.get("id", ""))
    english = _english(resource)
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
        course = Course(
            org_id=organization.id or 0,
            course_uuid=native_id,
            name=str(english.get("title", "")),
            description=str(english.get("summary", "")),
            about=str(english.get("summary", "")),
            learnings="[]",
            tags="",
            public=False,
            published=False,
            open_to_contributors=False,
            creation_date=now,
            update_date=now,
            extra_metadata=_source_metadata(source_id, digest),
        )
    else:
        _assert_owned(course, source_id)
        course.name = str(english.get("title", ""))
        course.description = str(english.get("summary", ""))
        course.about = str(english.get("summary", ""))
        course.public = False
        course.published = False
        course.update_date = now
        course.extra_metadata = _source_metadata(source_id, digest)
    db_session.add(course)
    await db_session.flush()
    return course


async def _upsert_chapter(
    db_session: AsyncSession,
    organization: Organization,
    course: Course,
    resource: dict[str, Any],
    native_id: str,
    digest: str,
    now: str,
) -> Chapter:
    source_id = str(resource.get("id", ""))
    chapter = (
        (await db_session.execute(select(Chapter).where(Chapter.chapter_uuid == native_id)))
        .scalars()
        .first()
    )
    if chapter is None:
        chapter = Chapter(
            chapter_uuid=native_id,
            name=str(_english(resource).get("title", "")),
            description="",
            lock_type=LockType.AUTHENTICATED,
            org_id=organization.id or 0,
            course_id=course.id or 0,
            creation_date=now,
            update_date=now,
            extra_metadata=_source_metadata(source_id, digest),
        )
    else:
        _assert_owned(chapter, source_id)
        chapter.name = str(_english(resource).get("title", ""))
        chapter.course_id = course.id or 0
        chapter.update_date = now
        chapter.extra_metadata = _source_metadata(source_id, digest)
    db_session.add(chapter)
    await db_session.flush()
    return chapter


async def _upsert_activity(
    db_session: AsyncSession,
    organization: Organization,
    course: Course,
    resource: dict[str, Any],
    native_id: str,
    digest: str,
    now: str,
) -> Activity:
    if resource.get("type") != "assessment":
        raise HTTPException(status_code=422, detail="Only assessment fixtures are supported before curriculum")
    source_id = str(resource.get("id", ""))
    activity = (
        (await db_session.execute(select(Activity).where(Activity.activity_uuid == native_id)))
        .scalars()
        .first()
    )
    if activity is None:
        activity = Activity(
            activity_uuid=native_id,
            name=str(_english(resource).get("title", "")),
            activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
            content={},
            details={},
            published=False,
            lock_type=ActivityLockType.AUTHENTICATED,
            org_id=organization.id or 0,
            course_id=course.id or 0,
            creation_date=now,
            update_date=now,
            extra_metadata=_source_metadata(source_id, digest),
        )
    else:
        _assert_owned(activity, source_id)
        activity.name = str(_english(resource).get("title", ""))
        activity.course_id = course.id or 0
        activity.published = False
        activity.update_date = now
        activity.extra_metadata = _source_metadata(source_id, digest)
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _upsert_assignment(
    db_session: AsyncSession,
    organization: Organization,
    course: Course,
    chapter: Chapter,
    activity: Activity,
    resource: dict[str, Any],
    native_id: str,
    now: str,
) -> Assignment:
    assignment = (
        (await db_session.execute(select(Assignment).where(Assignment.assignment_uuid == native_id)))
        .scalars()
        .first()
    )
    english = _english(resource)
    if assignment is None:
        assignment = Assignment(
            assignment_uuid=native_id,
            title=str(english.get("prompt", "")),
            description="Synthetic platform proof only.",
            due_date="2099-12-31",
            published=False,
            grading_type=GradingTypeEnum.NUMERIC,
            auto_grading=True,
            show_correct_answers=True,
            allow_retries=True,
            max_retries=0,
            org_id=organization.id or 0,
            course_id=course.id or 0,
            chapter_id=chapter.id or 0,
            activity_id=activity.id or 0,
            creation_date=now,
            update_date=now,
        )
    else:
        assignment.title = str(english.get("prompt", ""))
        assignment.description = "Synthetic platform proof only."
        assignment.course_id = course.id or 0
        assignment.chapter_id = chapter.id or 0
        assignment.activity_id = activity.id or 0
        assignment.published = False
        assignment.update_date = now
    db_session.add(assignment)
    await db_session.flush()

    task_uuid = f"assignmenttask_{sha256(native_id.encode()).hexdigest()[:24]}"
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
    options = english.get("options")
    if not isinstance(options, list) or not options:
        raise HTTPException(status_code=422, detail="Synthetic assessment has no options")
    contents = {
        "questions": [
            {
                "questionUUID": "question_platform_readiness",
                "options": [
                    {
                        "optionUUID": str(option.get("id", "")),
                        "label": str(option.get("label", "")),
                        "assigned_right_answer": option.get("correct") is True,
                    }
                    for option in options
                    if isinstance(option, dict)
                ],
            }
        ]
    }
    if task is None:
        task = AssignmentTask(
            assignment_task_uuid=task_uuid,
            title=str(english.get("prompt", "")),
            description=str(english.get("prompt", "")),
            hint="",
            assignment_type=AssignmentTaskTypeEnum.QUIZ,
            contents=contents,
            max_grade_value=100,
            assignment_id=assignment.id or 0,
            org_id=organization.id or 0,
            course_id=course.id or 0,
            chapter_id=chapter.id or 0,
            activity_id=activity.id or 0,
            creation_date=now,
            update_date=now,
        )
    else:
        has_submission = (
            (
                await db_session.execute(
                    select(AssignmentTaskSubmission.id).where(
                        AssignmentTaskSubmission.assignment_task_id == task.id
                    )
                )
            )
            .scalars()
            .first()
            is not None
        )
        expected_parents = (
            assignment.id or 0,
            course.id or 0,
            chapter.id or 0,
            activity.id or 0,
        )
        current_parents = (
            task.assignment_id,
            task.course_id,
            task.chapter_id,
            task.activity_id,
        )
        if has_submission and (
            task.title != str(english.get("prompt", ""))
            or task.description != str(english.get("prompt", ""))
            or task.contents != contents
            or current_parents != expected_parents
        ):
            raise HTTPException(
                status_code=409,
                detail="Published Academy assessment history is immutable",
            )
        task.title = str(english.get("prompt", ""))
        task.description = str(english.get("prompt", ""))
        task.contents = contents
        task.assignment_id = assignment.id or 0
        task.org_id = organization.id or 0
        task.course_id = course.id or 0
        task.chapter_id = chapter.id or 0
        task.activity_id = activity.id or 0
        task.update_date = now
    db_session.add(task)
    return assignment


async def project_graph(
    body: AcademyReleaseInput,
    db_session: AsyncSession,
    organization: Organization,
) -> None:
    courses = _records(body.graph, "courses")
    modules = _records(body.graph, "modules")
    lessons = _records(body.graph, "lessons")
    assessments = _records(body.graph, "assessments")
    ids = {key: _native_ids(body.graph, key) for key in ("courses", "modules", "lessons", "assessments")}
    now = datetime.now(timezone.utc).isoformat()
    managed_courses = []
    course_by_source: dict[str, Course] = {}
    chapter_by_source: dict[str, Chapter] = {}
    activity_by_source: dict[str, Activity] = {}

    incoming_course_sources = {str(resource.get("id", "")) for resource in courses}
    existing_courses = (
        (
            await db_session.execute(
                select(Course).where(Course.org_id == organization.id)
            )
        )
        .scalars()
        .all()
    )
    omitted_course_ids: list[int] = []
    for existing_course in existing_courses:
        metadata = (
            existing_course.extra_metadata
            if isinstance(existing_course.extra_metadata, dict)
            else {}
        )
        if (
            metadata.get("academy_source") is True
            and metadata.get("source_id") not in incoming_course_sources
        ):
            existing_course.public = False
            existing_course.published = False
            db_session.add(existing_course)
            if existing_course.id is not None:
                omitted_course_ids.append(existing_course.id)

    if omitted_course_ids:
        omitted_activities = (
            (
                await db_session.execute(
                    select(Activity).where(Activity.course_id.in_(omitted_course_ids))
                )
            )
            .scalars()
            .all()
        )
        for activity in omitted_activities:
            activity.published = False
            db_session.add(activity)
        omitted_assignments = (
            (
                await db_session.execute(
                    select(Assignment).where(Assignment.course_id.in_(omitted_course_ids))
                )
            )
            .scalars()
            .all()
        )
        for assignment in omitted_assignments:
            assignment.published = False
            db_session.add(assignment)
        await db_session.execute(
            delete(ChapterActivity).where(ChapterActivity.course_id.in_(omitted_course_ids))
        )
        await db_session.execute(
            delete(CourseChapter).where(CourseChapter.course_id.in_(omitted_course_ids))
        )

    for resource in courses:
        source_id = str(resource.get("id", ""))
        native_id = ids["courses"].get(source_id)
        if not native_id:
            raise HTTPException(status_code=422, detail=f"Course {source_id} has no native ID")
        course = await _upsert_course(
            db_session, organization, resource, native_id, body.compiled_digest, now
        )
        course_by_source[source_id] = course
        managed_courses.append(course)

    course_ids = [course.id for course in managed_courses if course.id is not None]
    if course_ids:
        stale_activities = (
            (await db_session.execute(select(Activity).where(Activity.course_id.in_(course_ids))))
            .scalars()
            .all()
        )
        for activity in stale_activities:
            metadata = activity.extra_metadata if isinstance(activity.extra_metadata, dict) else {}
            if metadata.get("academy_source") is True:
                activity.published = False
                db_session.add(activity)
        stale_assignments = (
            (await db_session.execute(select(Assignment).where(Assignment.course_id.in_(course_ids))))
            .scalars()
            .all()
        )
        for assignment in stale_assignments:
            assignment.published = False
            db_session.add(assignment)
        await db_session.execute(delete(ChapterActivity).where(ChapterActivity.course_id.in_(course_ids)))
        await db_session.execute(delete(CourseChapter).where(CourseChapter.course_id.in_(course_ids)))

    for resource in sorted(modules, key=lambda item: int(item.get("order", 0))):
        source_id = str(resource.get("id", ""))
        course = course_by_source.get(str(resource.get("courseId", "")))
        native_id = ids["modules"].get(source_id)
        if course is None or not native_id:
            raise HTTPException(status_code=422, detail=f"Module {source_id} has invalid parents")
        chapter = await _upsert_chapter(
            db_session, organization, course, resource, native_id, body.compiled_digest, now
        )
        chapter_by_source[source_id] = chapter
        db_session.add(
            CourseChapter(
                order=int(resource.get("order", 0)),
                course_id=course.id or 0,
                chapter_id=chapter.id or 0,
                org_id=organization.id or 0,
                creation_date=now,
                update_date=now,
            )
        )

    for resource in sorted(lessons, key=lambda item: int(item.get("order", 0))):
        source_id = str(resource.get("id", ""))
        chapter = chapter_by_source.get(str(resource.get("moduleId", "")))
        native_id = ids["lessons"].get(source_id)
        if chapter is None or not native_id:
            raise HTTPException(status_code=422, detail=f"Lesson {source_id} has invalid parents")
        course = next(course for course in managed_courses if course.id == chapter.course_id)
        activity = await _upsert_activity(
            db_session, organization, course, resource, native_id, body.compiled_digest, now
        )
        activity_by_source[source_id] = activity
        db_session.add(
            ChapterActivity(
                order=int(resource.get("order", 0)),
                chapter_id=chapter.id or 0,
                activity_id=activity.id or 0,
                course_id=course.id or 0,
                org_id=organization.id or 0,
                creation_date=now,
                update_date=now,
            )
        )

    for resource in assessments:
        source_id = str(resource.get("id", ""))
        lesson = next(
            (item for item in lessons if item.get("assessmentId") == source_id), None
        )
        activity = activity_by_source.get(str(resource.get("lessonId", "")))
        native_id = ids["assessments"].get(source_id)
        if lesson is None or activity is None or not native_id:
            raise HTTPException(status_code=422, detail=f"Assessment {source_id} has invalid parents")
        chapter = chapter_by_source[str(lesson.get("moduleId", ""))]
        course = next(course for course in managed_courses if course.id == activity.course_id)
        assignment = await _upsert_assignment(
            db_session, organization, course, chapter, activity, resource, native_id, now
        )
        assignment.published = True
        activity.published = True
        db_session.add(assignment)
        db_session.add(activity)

    for resource in courses:
        course = course_by_source[str(resource.get("id", ""))]
        visible = resource.get("status") == "published"
        course.public = visible
        course.published = visible
        db_session.add(course)
    await db_session.flush()
