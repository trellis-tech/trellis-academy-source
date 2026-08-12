"""Focused regressions for the P1 security guards found during baseline review."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.users import APITokenUser
from src.routers import audit, code_execution, code_submissions
from src.routers.playgrounds import playgrounds_generator
from src.services.ai.rag import query_service


pytestmark = pytest.mark.asyncio


def _token(org_id: int = 7) -> APITokenUser:
    return APITokenUser(id=41, org_id=org_id, created_by_user_id=9)


async def test_audit_rejects_api_tokens_before_admin_resolution():
    db_session = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await audit._require_admin(_token(), 7, db_session)

    assert exc.value.status_code == 403
    db_session.execute.assert_not_awaited()


async def test_code_submission_rejects_api_token_identity():
    body = code_submissions.SaveSubmissionRequest(
        activity_uuid="activity_1",
        block_id="block_1",
        language_id=71,
        source_code="print('ok')",
        results={},
        passed=True,
        total_tests=1,
        passed_tests=1,
    )
    db_session = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await code_submissions.save_submission(body, _token(), db_session)

    assert exc.value.status_code == 403
    db_session.commit.assert_not_awaited()


@pytest.mark.parametrize("handler", [code_execution.execute_code, code_execution.execute_batch])
async def test_code_execution_rejects_api_tokens_before_judge0(handler):
    if handler is code_execution.execute_code:
        body = code_execution.ExecuteRequest(language_id=71, source_code="print(1)")
    else:
        body = code_execution.ExecuteBatchRequest(
            language_id=71,
            source_code="print(1)",
            test_cases=[],
        )

    with patch.object(code_execution, "_get_judge0_config") as config:
        with pytest.raises(HTTPException) as exc:
            await handler(MagicMock(), body, _token(), AsyncMock())

    assert exc.value.status_code == 403
    config.assert_not_called()


async def test_playground_session_enforces_api_token_org_scope():
    session = SimpleNamespace(playground_uuid="playground_1")
    playground = SimpleNamespace(org_id=8)
    result = MagicMock()
    result.scalars.return_value.first.return_value = playground
    db_session = AsyncMock()
    db_session.execute.return_value = result

    with patch.object(playgrounds_generator, "get_playground_session", return_value=session):
        with pytest.raises(HTTPException) as exc:
            await playgrounds_generator.get_session_state(
                "session_1", _token(org_id=7), db_session
            )

    assert exc.value.status_code == 403


async def test_org_wide_rag_with_no_readable_courses_skips_embedding():
    with patch.object(query_service, "embed_single_text", new=AsyncMock()) as embed:
        result = await query_service.query_course_rag(
            "question", 7, AsyncMock(), allowed_course_ids=[]
        )

    assert result == {"context": "", "sources": []}
    embed.assert_not_awaited()


async def test_org_wide_rag_binds_the_readable_course_ids():
    rows = MagicMock()
    rows.fetchall.return_value = []
    db_session = AsyncMock()
    db_session.execute.return_value = rows

    with patch.object(
        query_service, "embed_single_text", new=AsyncMock(return_value=[0.25])
    ):
        await query_service.query_course_rag(
            "question", 7, db_session, allowed_course_ids=[3, 5]
        )

    params = db_session.execute.await_args.args[1]
    assert params["org_id"] == 7
    assert params["allowed_course_ids"] == [3, 5]
