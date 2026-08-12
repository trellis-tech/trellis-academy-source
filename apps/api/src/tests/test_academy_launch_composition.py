"""Launch-composition contract for Trellis Academy."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI


API_ROOT = Path(__file__).resolve().parents[2]


def test_academy_router_exposes_only_launch_learning_surfaces():
    from src.academy.router import academy_v1_router

    app = FastAPI()
    app.include_router(academy_v1_router)
    paths = set(app.openapi()["paths"])

    for prefix in (
        "/api/v1/health",
        "/api/v1/courses",
        "/api/v1/chapters",
        "/api/v1/activities",
        "/api/v1/assignments",
        "/api/v1/certifications",
        "/api/v1/folders",
        "/api/v1/media",
        "/api/v1/trail",
        "/api/v1/search",
        "/api/v1/auth/trellis",
        "/api/v1/orgs/slug/{org_slug}",
        "/api/v1/users/session",
    ):
        assert any(path == prefix or path.startswith(f"{prefix}/") for path in paths), prefix

    forbidden_fragments = (
        "/ai",
        "ai-credits",
        "/packs",
        "/plans",
        "/communities",
        "/discussions",
        "/playgrounds",
        "/mfa",
        "/oauth",
        "/emails",
        "/nudges",
        "/callback",
        "/cloud_internal",
    )
    for fragment in forbidden_fragments:
        assert not any(fragment in path for path in paths), fragment

    assert "/api/v1/activities/video/{activity_uuid}/captions" not in paths
    course_operations = app.openapi()["paths"]["/api/v1/courses/{course_uuid}"]
    assert "get" in course_operations
    assert "put" not in course_operations
    for excluded_path in (
        "/api/v1/courses/export/batch",
        "/api/v1/courses/import/analyze",
        "/api/v1/courses/import",
        "/api/v1/courses/{course_uuid}/clone",
        "/api/v1/courses/{course_uuid}/export",
        "/api/v1/folders/",
        "/api/v1/media/",
    ):
        assert excluded_path not in paths
    assert "/api/v1/orgs/" not in paths
    assert "/api/v1/orgs/{org_id}" not in paths
    assert "/api/v1/users/{org_id}" not in paths
    assert "/api/v1/auth/trellis/exchange" in paths
    assert "/api/v1/auth/trellis/refresh" in paths
    assert "/api/v1/auth/trellis/logout" in paths
    for native_auth_path in (
        "/api/v1/auth/login",
        "/api/v1/auth/oauth",
        "/api/v1/auth/refresh",
        "/api/v1/auth/magic-link/request",
        "/api/v1/auth/magic-link/verify",
        "/api/v1/auth/verify-email",
    ):
        assert native_auth_path not in paths

def test_app_uses_academy_composition_instead_of_upstream_root_router():
    source = (API_ROOT / "app.py").read_text()

    assert "from src.academy.router import academy_v1_router" in source
    assert "from src.academy.events import" in source
    assert "academy_startup_app" in source
    assert "academy_shutdown_app" in source
    assert "app.include_router(academy_v1_router)" in source
    assert "from src.router import v1_router" not in source
    assert "register_ee_middlewares" not in source


@pytest.mark.asyncio
async def test_academy_startup_only_initializes_required_runtime(monkeypatch):
    from src.academy import events

    app = SimpleNamespace()
    config = SimpleNamespace()
    connect_to_db = AsyncMock()
    create_logs_dir = AsyncMock()
    check_content_directory = AsyncMock()

    monkeypatch.setattr(events, "get_learnhouse_config", lambda: config)
    monkeypatch.setattr(events, "connect_to_db", connect_to_db)
    monkeypatch.setattr(events, "create_logs_dir", create_logs_dir)
    monkeypatch.setattr(events, "check_content_directory", check_content_directory)

    await events.academy_startup_app(app)()

    assert app.learnhouse_config is config
    connect_to_db.assert_awaited_once_with(app, bootstrap_schema=False)
    create_logs_dir.assert_awaited_once_with()
    check_content_directory.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_academy_shutdown_only_closes_database(monkeypatch):
    from src.academy import events

    app = SimpleNamespace()
    close_database = AsyncMock()
    monkeypatch.setattr(events, "close_database", close_database)

    await events.academy_shutdown_app(app)()

    close_database.assert_awaited_once_with(app)
