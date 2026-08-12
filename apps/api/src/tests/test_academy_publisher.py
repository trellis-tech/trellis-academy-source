import hashlib
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlmodel import select
from starlette.requests import Request

from src.academy.publisher import (
    AcademyReleaseRequest,
    AcademyRollbackRequest,
    PUBLICATION_LOCK_KEY,
    _acquire_publication_lock,
    get_current_academy_release,
    publish_academy_release,
    require_publisher_principal,
    _canonical_digest,
    rollback_academy_release,
)
from src.db.academy_publications import AcademyPublication
from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask, AssignmentTaskSubmission
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course


def test_canonical_digest_matches_utf8_json_for_localized_content() -> None:
    graph = {"title": "Español العربية"}
    expected = hashlib.sha256(
        json.dumps(graph, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    assert _canonical_digest(graph) == expected


@pytest.mark.asyncio
async def test_publication_lock_uses_a_postgres_transaction_advisory_lock() -> None:
    class PostgreSQLSession:
        execute = AsyncMock()

        @staticmethod
        def get_bind():
            class Dialect:
                name = "postgresql"

            class Bind:
                dialect = Dialect()

            return Bind()

    session = PostgreSQLSession()
    await _acquire_publication_lock(session)  # type: ignore[arg-type]

    statement, parameters = session.execute.await_args.args
    assert str(statement) == "SELECT pg_advisory_xact_lock(:lock_key)"
    assert parameters == {"lock_key": PUBLICATION_LOCK_KEY}


def _request(secret: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/publisher/releases",
            "headers": [(b"authorization", f"Bearer {secret}".encode())],
        }
    )


def _graph(source_commit: str = "a" * 40) -> dict:
    return {
        "version": 1,
        "academy": {
            "id": "trellis-academy",
            "title": "Trellis Academy",
            "catalog": ["platform-readiness"],
        },
        "courses": [
            {
                "id": "platform-readiness",
                "status": "published",
                "locales": {
                    "en": {
                        "title": "Platform readiness fixture",
                        "summary": "Synthetic proof only.",
                    }
                },
                "modules": ["platform-readiness-module"],
            }
        ],
        "modules": [
            {
                "id": "platform-readiness-module",
                "courseId": "platform-readiness",
                "order": 1,
                "locales": {"en": {"title": "Platform readiness module"}},
                "lessons": ["platform-readiness-check"],
            }
        ],
        "lessons": [
            {
                "id": "platform-readiness-check",
                "moduleId": "platform-readiness-module",
                "order": 1,
                "type": "assessment",
                "locales": {"en": {"title": "Platform readiness check"}},
                "assessmentId": "platform-readiness-quiz",
            }
        ],
        "assessments": [
            {
                "id": "platform-readiness-quiz",
                "lessonId": "platform-readiness-check",
                "kind": "quiz",
                "locales": {
                    "en": {
                        "prompt": "Choose Trellis.",
                        "options": [
                            {"id": "trellis", "label": "Trellis", "correct": True},
                            {"id": "other", "label": "Other", "correct": False},
                        ],
                    }
                },
            }
        ],
        "sourceCommit": source_commit,
        "nativeIds": {
            "courses": {"platform-readiness": "course_111111111111111111111111"},
            "modules": {"platform-readiness-module": "chapter_222222222222222222222222"},
            "lessons": {"platform-readiness-check": "activity_333333333333333333333333"},
            "assessments": {"platform-readiness-quiz": "assignment_444444444444444444444444"},
        },
    }


def _digest(graph: dict) -> str:
    canonical = json.dumps(graph, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def test_publisher_principal_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_PUBLISHER_SECRET", "publisher-secret")
    require_publisher_principal(_request("publisher-secret"))

    with pytest.raises(HTTPException) as forbidden:
        require_publisher_principal(_request("wrong-secret"))
    assert forbidden.value.status_code == 401

    monkeypatch.delenv("TRELLIS_ACADEMY_PUBLISHER_SECRET")
    with pytest.raises(HTTPException) as unavailable:
        require_publisher_principal(_request("publisher-secret"))
    assert unavailable.value.status_code == 503


@pytest.mark.asyncio
async def test_atomic_projection_is_idempotent_and_records_readback(
    db,
    org,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    graph = _graph()
    body = AcademyReleaseRequest(
        compiled_digest=_digest(graph),
        graph=graph,
        operator_instruction="publish synthetic platform fixture",
        release_tag="academy-release/test-a",
        environment="test",
        rollback_target="academy-release/empty",
    )

    first = await publish_academy_release(body, db)
    second = await publish_academy_release(body, db)
    current = await get_current_academy_release(db)

    assert first.status == "succeeded"
    assert first.readback_digest == body.compiled_digest
    assert second.compiled_digest == first.compiled_digest
    assert second.receipt_uuid == first.receipt_uuid
    assert current.receipt_uuid == first.receipt_uuid
    assert len((await db.execute(select(Course))).scalars().all()) == 1
    assert len((await db.execute(select(Chapter))).scalars().all()) == 1
    assert len((await db.execute(select(Activity))).scalars().all()) == 1
    assert len((await db.execute(select(Assignment))).scalars().all()) == 1
    assert len((await db.execute(select(AssignmentTask))).scalars().all()) == 1
    assert len((await db.execute(select(AcademyPublication))).scalars().all()) == 1

    course = (await db.execute(select(Course))).scalars().one()
    assignment = (await db.execute(select(Assignment))).scalars().one()
    assert course.course_uuid == "course_111111111111111111111111"
    assert course.public is True
    assert course.published is True
    assert assignment.assignment_uuid == "assignment_444444444444444444444444"
    assert assignment.published is True


@pytest.mark.asyncio
async def test_publish_and_rollback_share_the_publication_transaction_lock(
    db,
    org,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.academy import publisher

    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    lock = AsyncMock()
    monkeypatch.setattr(publisher, "_acquire_publication_lock", lock, raising=False)
    graph = _graph()
    published = AcademyReleaseRequest(
        compiled_digest=_digest(graph),
        graph=graph,
        operator_instruction="publish under the shared transaction lock",
        release_tag="academy-release/locked",
        environment="test",
        rollback_target="academy-release/empty",
    )

    await publish_academy_release(published, db)
    await rollback_academy_release(
        "academy-release/empty",
        AcademyRollbackRequest(
            operator_instruction="rollback under the shared transaction lock",
            release_tag="academy-release/locked-rollback",
            environment="test",
        ),
        db,
    )

    assert lock.await_args_list == [((db,),), ((db,),)]


@pytest.mark.asyncio
async def test_projection_rejects_a_digest_mismatch(db, org, monkeypatch) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    graph = _graph()
    body = AcademyReleaseRequest(
        compiled_digest="0" * 64,
        graph=graph,
        operator_instruction="publish synthetic platform fixture",
        release_tag="academy-release/test-invalid",
        environment="test",
        rollback_target="academy-release/empty",
    )

    with pytest.raises(HTTPException) as invalid:
        await publish_academy_release(body, db)
    assert invalid.value.status_code == 422
    assert (await db.execute(select(Course))).scalars().all() == []


@pytest.mark.asyncio
async def test_rollback_archives_the_release_and_allows_a_clean_republish(
    db,
    org,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    graph = _graph()
    published = AcademyReleaseRequest(
        compiled_digest=_digest(graph),
        graph=graph,
        operator_instruction="publish synthetic platform fixture",
        release_tag="academy-release/test-before-rollback",
        environment="test",
        rollback_target="academy-release/empty",
    )
    await publish_academy_release(published, db)

    rollback = await rollback_academy_release(
        "academy-release/empty",
        AcademyRollbackRequest(
            operator_instruction="rollback synthetic platform fixture",
            release_tag="academy-release/test-rollback",
            environment="test",
        ),
        db,
    )

    assert rollback.status == "succeeded"
    assert rollback.rollback_target == published.release_tag
    course = (await db.execute(select(Course))).scalars().one()
    activity = (await db.execute(select(Activity))).scalars().one()
    assignment = (await db.execute(select(Assignment))).scalars().one()
    assert course.public is False
    assert course.published is False
    assert activity.published is False
    assert assignment.published is False
    assert len((await db.execute(select(AcademyPublication))).scalars().all()) == 2

    retry = await rollback_academy_release(
        "academy-release/empty",
        AcademyRollbackRequest(
            operator_instruction="retry lost compensation response",
            release_tag="academy-release/test-rollback",
            environment="test",
        ),
        db,
    )
    assert retry.receipt_uuid == rollback.receipt_uuid
    assert retry.compiled_digest == _canonical_digest({})
    persisted_retry = (
        (
            await db.execute(
                select(AcademyPublication).where(
                    AcademyPublication.receipt_uuid == retry.receipt_uuid
                )
            )
        )
        .scalars()
        .one()
    )
    assert persisted_retry.after_state == {}

    restored = published.model_copy(
        update={
            "release_tag": "academy-release/test-after-rollback",
            "rollback_target": rollback.release_tag,
        }
    )
    await publish_academy_release(restored, db)
    await db.refresh(course)
    await db.refresh(activity)
    await db.refresh(assignment)
    assert course.public is True
    assert course.published is True
    assert activity.published is True
    assert assignment.published is True

    changed_graph = _graph(source_commit="b" * 40)
    changed_graph["courses"][0]["locales"]["en"]["title"] = "Changed fixture"
    changed = AcademyReleaseRequest(
        compiled_digest=_digest(changed_graph),
        graph=changed_graph,
        operator_instruction="publish changed synthetic fixture",
        release_tag="academy-release/test-changed",
        environment="test",
        rollback_target=restored.release_tag,
    )
    await publish_academy_release(changed, db)
    await db.refresh(course)
    assert course.name == "Changed fixture"

    current = await get_current_academy_release(db)
    assert current.release_tag == changed.release_tag

    await rollback_academy_release(
        restored.release_tag,
        AcademyRollbackRequest(
            operator_instruction="restore previous synthetic fixture",
            release_tag="academy-release/test-restored",
            environment="test",
        ),
        db,
    )
    await db.refresh(course)
    assert course.name == "Platform readiness fixture"
    assert course.public is True
    assert course.published is True

    with pytest.raises(HTTPException) as stale_rollback:
        await rollback_academy_release(
            "academy-release/empty",
            AcademyRollbackRequest(
                operator_instruction="retry stale rollback",
                release_tag=rollback.release_tag,
                environment="test",
            ),
            db,
        )
    assert stale_rollback.value.status_code == 409


@pytest.mark.asyncio
async def test_removed_course_is_archived_and_stale_release_retry_is_rejected(
    db,
    org,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    first_graph = _graph()
    first = AcademyReleaseRequest(
        compiled_digest=_digest(first_graph),
        graph=first_graph,
        operator_instruction="publish first graph",
        release_tag="academy-release/first",
        environment="test",
        rollback_target="academy-release/empty",
    )
    await publish_academy_release(first, db)

    empty_graph = _graph(source_commit="b" * 40)
    empty_graph["academy"]["catalog"] = []
    for key in ("courses", "modules", "lessons", "assessments"):
        empty_graph[key] = []
        empty_graph["nativeIds"][key] = {}
    second = AcademyReleaseRequest(
        compiled_digest=_digest(empty_graph),
        graph=empty_graph,
        operator_instruction="remove synthetic graph",
        release_tag="academy-release/second",
        environment="test",
        rollback_target=first.release_tag,
    )
    await publish_academy_release(second, db)

    course = (await db.execute(select(Course))).scalars().one()
    activity = (await db.execute(select(Activity))).scalars().one()
    assignment = (await db.execute(select(Assignment))).scalars().one()
    assert course.public is False and course.published is False
    assert activity.published is False
    assert assignment.published is False

    with pytest.raises(HTTPException) as stale:
        await publish_academy_release(first, db)
    assert stale.value.status_code == 409


@pytest.mark.asyncio
async def test_moved_assessment_reparents_task_and_retry_verifies_full_readback(
    db,
    org,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    first_graph = _graph()
    first = AcademyReleaseRequest(
        compiled_digest=_digest(first_graph),
        graph=first_graph,
        operator_instruction="publish first hierarchy",
        release_tag="academy-release/hierarchy-a",
        environment="test",
        rollback_target="academy-release/empty",
    )
    await publish_academy_release(first, db)

    moved_graph = _graph(source_commit="b" * 40)
    moved_graph["courses"][0]["modules"] = ["replacement-module"]
    moved_graph["modules"][0]["id"] = "replacement-module"
    moved_graph["modules"][0]["lessons"] = ["replacement-check"]
    moved_graph["lessons"][0]["id"] = "replacement-check"
    moved_graph["lessons"][0]["moduleId"] = "replacement-module"
    moved_graph["assessments"][0]["lessonId"] = "replacement-check"
    moved_graph["nativeIds"]["modules"] = {
        "replacement-module": "chapter_555555555555555555555555"
    }
    moved_graph["nativeIds"]["lessons"] = {
        "replacement-check": "activity_666666666666666666666666"
    }
    moved = AcademyReleaseRequest(
        compiled_digest=_digest(moved_graph),
        graph=moved_graph,
        operator_instruction="move assessment hierarchy",
        release_tag="academy-release/hierarchy-b",
        environment="test",
        rollback_target=first.release_tag,
    )
    await publish_academy_release(moved, db)

    assignment = (await db.execute(select(Assignment))).scalars().one()
    task = (await db.execute(select(AssignmentTask))).scalars().one()
    assert task.assignment_id == assignment.id
    assert task.course_id == assignment.course_id
    assert task.chapter_id == assignment.chapter_id
    assert task.activity_id == assignment.activity_id

    task.contents = {"questions": []}
    db.add(task)
    await db.commit()
    with pytest.raises(HTTPException) as invalid_readback:
        await publish_academy_release(moved, db)
    assert invalid_readback.value.status_code == 500


@pytest.mark.asyncio
async def test_publisher_versions_assessments_and_rolls_back_after_submissions(
    db,
    org,
    regular_user,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    graph = _graph()
    first = AcademyReleaseRequest(
        compiled_digest=_digest(graph),
        graph=graph,
        operator_instruction="publish immutable assessment",
        release_tag="academy-release/immutable-a",
        environment="test",
        rollback_target="academy-release/empty",
    )
    await publish_academy_release(first, db)
    task = (await db.execute(select(AssignmentTask))).scalars().one()
    db.add(
        AssignmentTaskSubmission(
            assignment_task_submission_uuid="task_submission_immutable",
            task_submission={"answer": "trellis"},
            grade=100,
            task_submission_grade_feedback="",
            assignment_type=task.assignment_type,
            user_id=regular_user.id,
            activity_id=task.activity_id,
            course_id=task.course_id,
            chapter_id=task.chapter_id,
            assignment_task_id=task.id,
            creation_date="now",
            update_date="now",
        )
    )
    await db.commit()

    changed_graph = _graph(source_commit="b" * 40)
    changed_graph["assessments"][0]["locales"]["en"]["prompt"] = "Changed question"
    changed_graph["nativeIds"]["assessments"]["platform-readiness-quiz"] = (
        "assignment_777777777777777777777777"
    )
    changed = AcademyReleaseRequest(
        compiled_digest=_digest(changed_graph),
        graph=changed_graph,
        operator_instruction="mutate graded assessment",
        release_tag="academy-release/immutable-b",
        environment="test",
        rollback_target=first.release_tag,
    )

    await publish_academy_release(changed, db)
    assignments = (await db.execute(select(Assignment).order_by(Assignment.id))).scalars().all()
    tasks = (await db.execute(select(AssignmentTask).order_by(AssignmentTask.id))).scalars().all()
    assert len(assignments) == 2
    assert len(tasks) == 2
    assert assignments[0].published is False
    assert assignments[1].published is True
    assert tasks[0].title == "Choose Trellis."
    assert tasks[1].title == "Changed question"
    db.add(
        AssignmentTaskSubmission(
            assignment_task_submission_uuid="task_submission_changed",
            task_submission={"answer": "other"},
            grade=0,
            task_submission_grade_feedback="",
            assignment_type=tasks[1].assignment_type,
            user_id=regular_user.id,
            activity_id=tasks[1].activity_id,
            course_id=tasks[1].course_id,
            chapter_id=tasks[1].chapter_id,
            assignment_task_id=tasks[1].id,
            creation_date="later",
            update_date="later",
        )
    )
    await db.commit()

    await rollback_academy_release(
        first.release_tag,
        AcademyRollbackRequest(
            operator_instruction="restore immutable assessment",
            release_tag="academy-release/immutable-rollback",
            environment="test",
        ),
        db,
    )

    await db.refresh(assignments[0])
    await db.refresh(assignments[1])
    await db.refresh(tasks[0])
    await db.refresh(tasks[1])
    assert assignments[0].published is True
    assert assignments[1].published is False
    assert tasks[0].title == "Choose Trellis."
    assert tasks[1].title == "Changed question"
    submissions = (await db.execute(select(AssignmentTaskSubmission))).scalars().all()
    assert len(submissions) == 2
