from fastapi.testclient import TestClient

from src.academy.release import router
from fastapi import FastAPI


def test_release_identity_reads_deployment_receipt(monkeypatch):
    monkeypatch.setenv("TRELLIS_ACADEMY_RELEASE_SHA", "a" * 40)
    monkeypatch.setenv("TRELLIS_ACADEMY_MIGRATION_HEAD", "u4v5w6x7y8z9")
    monkeypatch.setenv(
        "TRELLIS_ACADEMY_SOURCE_URL",
        "https://github.com/trellis-tech/trellis/releases/tag/academy-source-v1",
    )
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/release")

    response = TestClient(app).get("/api/v1/release")

    assert response.status_code == 200
    assert response.json() == {
        "revision": "a" * 40,
        "migration_head": "u4v5w6x7y8z9",
        "source_url": "https://github.com/trellis-tech/trellis/releases/tag/academy-source-v1",
    }


def test_release_identity_has_explicit_local_fallbacks(monkeypatch):
    for key in (
        "TRELLIS_ACADEMY_RELEASE_SHA",
        "TRELLIS_ACADEMY_MIGRATION_HEAD",
        "TRELLIS_ACADEMY_SOURCE_URL",
    ):
        monkeypatch.delenv(key, raising=False)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/release")

    response = TestClient(app).get("/api/v1/release")

    assert response.json() == {
        "revision": "development",
        "migration_head": "unknown",
        "source_url": None,
    }
