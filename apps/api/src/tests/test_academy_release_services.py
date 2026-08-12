"""Release-one service boundaries for the Trellis Academy runtime."""

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest


API_ROOT = Path(__file__).resolve().parents[2]


def test_academy_app_does_not_import_excluded_runtime_services():
    env = {
        **os.environ,
        "TESTING": "true",
        "LEARNHOUSE_DISABLE_EE": "1",
        "LEARNHOUSE_AUTH_JWT_SECRET_KEY": "test-secret-key-for-unit-tests-32chars!",
    }
    script = """
import sys
from app import app

forbidden = (
    "src.security.features_utils",
    "src.services.search.search",
    "src.services.ai",
    "src.services.utils.caption_jobs",
)
loaded = sorted(name for name in sys.modules if name.startswith(forbidden))
if loaded:
    raise SystemExit("excluded runtime imports: " + ", ".join(loaded))
"""

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=API_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_learning_services_use_only_academy_release_policy():
    service_paths = (
        "src/services/courses/courses.py",
        "src/services/courses/activities/assignments.py",
        "src/services/courses/activities/activities.py",
        "src/services/courses/activities/versioning.py",
    )
    forbidden = (
        "src.security.features_utils",
        "src.core.ee_hooks",
        "check_ee_activity_paid_access",
        "configure_captions",
    )

    for relative_path in service_paths:
        source = (API_ROOT / relative_path).read_text()
        for fragment in forbidden:
            assert fragment not in source, f"{relative_path}: {fragment}"


def test_academy_search_owns_an_allowed_content_only_schema():
    router_source = (API_ROOT / "src/academy/router.py").read_text()
    search_source = (API_ROOT / "src/academy/search.py").read_text()

    assert "from src.academy import search" in router_source
    assert "src.services.search.search" not in router_source
    assert "search_courses" in search_source
    assert "Folder" in search_source

    for fragment in (
        "Community",
        "Discussion",
        "Playground",
        "Podcast",
        "UserOrganization",
    ):
        assert fragment not in search_source


@pytest.mark.asyncio
async def test_academy_search_returns_only_allowed_content(
    db,
    org,
    folder,
    anonymous_user,
    mock_request,
    monkeypatch,
):
    from src.academy import search

    search_courses = AsyncMock(return_value=[])
    monkeypatch.setattr(search, "search_courses", search_courses)

    result = await search.search_academy_content(
        mock_request,
        anonymous_user,
        org.slug,
        "Test",
        db,
    )

    assert result.model_dump().keys() == {
        "courses",
        "folders",
        "total_courses",
        "total_folders",
    }
    assert [item.folder_uuid for item in result.folders] == [folder.folder_uuid]
    search_courses.assert_awaited_once()
