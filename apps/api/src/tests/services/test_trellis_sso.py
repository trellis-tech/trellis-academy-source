from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import jwt
import pytest
from fastapi import HTTPException
from sqlmodel import select
from starlette.requests import Request

from src.db.trellis_identities import TrellisIdentity
from src.db.roles import RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.security.auth import create_refresh_token, decode_jwt
from src.security.session_context import AUTH_METHOD_SSO, session_claims
from src.services.auth.trellis_sso import (
    ACADEMY_ROLE_CLAIM,
    TrellisAssertionClaims,
    TrellisSubjectStatus,
    academy_role_for_email,
    introspect_trellis_subject,
    provision_trellis_learner,
    verify_and_consume_assertion,
)


class FakeRedis:
    def __init__(self) -> None:
        self.keys: set[str] = set()

    def set(self, key: str, _value: str, *, nx: bool, ex: int) -> bool:
        assert nx is True
        assert ex > 0
        if key in self.keys:
            return False
        self.keys.add(key)
        return True


class FakeIntrospectionClient:
    def __init__(self, response) -> None:
        self.response = response
        self.request = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args) -> None:
        return None

    async def post(self, url: str, **kwargs):
        self.request = (url, kwargs)
        return self.response


def make_assertion(secret: str, **overrides: object) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, object] = {
        "iss": "trellis-app",
        "aud": "trellis-academy",
        "sub": "0f939709-c592-4abf-9589-241ad714f8e2",
        "jti": "assertion-1",
        "iat": now,
        "exp": now + timedelta(seconds=60),
        "email": "learner@example.com",
        "name": "Academy Learner",
    }
    payload.update(overrides)
    return jwt.encode(payload, secret, algorithm="HS256")


def test_trellis_identity_timestamps_preserve_timezone() -> None:
    assert TrellisIdentity.__table__.c.created_at.type.timezone is True
    assert TrellisIdentity.__table__.c.last_synced_at.type.timezone is True


def test_verifies_and_consumes_a_trellis_assertion_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "learner@example.com")
    redis = FakeRedis()
    assertion = make_assertion("test-shared-secret")

    claims = verify_and_consume_assertion(assertion, redis)

    assert claims.subject == "0f939709-c592-4abf-9589-241ad714f8e2"
    assert claims.email == "learner@example.com"
    assert claims.name == "Academy Learner"

    with pytest.raises(HTTPException) as replay:
        verify_and_consume_assertion(assertion, redis)
    assert replay.value.status_code == 410


def test_rejects_wrong_audience_without_consuming(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "learner@example.com")
    redis = FakeRedis()

    with pytest.raises(HTTPException) as invalid:
        verify_and_consume_assertion(
            make_assertion("test-shared-secret", aud="another-service"),
            redis,
        )

    assert invalid.value.status_code == 401
    assert redis.keys == set()


def test_fails_closed_when_replay_store_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "learner@example.com")

    with pytest.raises(HTTPException) as unavailable:
        verify_and_consume_assertion(make_assertion("test-shared-secret"), None)

    assert unavailable.value.status_code == 503


def test_fails_closed_when_email_is_not_allowlisted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "michel@trellistech.com")
    redis = FakeRedis()

    with pytest.raises(HTTPException) as forbidden:
        verify_and_consume_assertion(make_assertion("test-shared-secret"), redis)

    assert forbidden.value.status_code == 403
    assert redis.keys == set()


def test_fails_closed_when_email_allowlist_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.delenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", raising=False)

    with pytest.raises(HTTPException) as unavailable:
        verify_and_consume_assertion(make_assertion("test-shared-secret"), FakeRedis())

    assert unavailable.value.status_code == 503


def test_owner_role_is_explicit_and_does_not_expand_the_login_allowlist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "TRELLIS_ACADEMY_ALLOWED_EMAILS",
        "learner@example.com,michel@trellistech.com",
    )
    monkeypatch.setenv(
        "TRELLIS_ACADEMY_OWNER_EMAILS", " MICHEL@TRELLISTECH.COM "
    )

    assert academy_role_for_email("michel@trellistech.com") == "owner"
    assert academy_role_for_email("learner@example.com") == "learner"


def test_owner_configuration_fails_closed_when_not_allowlisted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "learner@example.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_OWNER_EMAILS", "michel@trellistech.com")

    with pytest.raises(HTTPException) as unavailable:
        academy_role_for_email("learner@example.com")
    assert unavailable.value.status_code == 503


def test_role_resolution_rejects_an_email_removed_from_the_allowlist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "michel@trellistech.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_OWNER_EMAILS", "michel@trellistech.com")

    with pytest.raises(HTTPException) as denied:
        academy_role_for_email("former-learner@example.com")
    assert denied.value.status_code == 403


@pytest.mark.asyncio
async def test_provisions_by_immutable_subject_and_syncs_profile(
    db, org, user_role
) -> None:
    user_role.org_id = None
    user_role.role_type = RoleTypeEnum.TYPE_GLOBAL
    db.add(user_role)
    await db.commit()

    first = await provision_trellis_learner(
        TrellisAssertionClaims(
            subject="0f939709-c592-4abf-9589-241ad714f8e2",
            email="learner@example.com",
            name="Academy Learner",
            avatar_url="https://assets.example.com/learner.png",
        ),
        db,
        org_slug=org.slug,
    )
    second = await provision_trellis_learner(
        TrellisAssertionClaims(
            subject="0f939709-c592-4abf-9589-241ad714f8e2",
            email="renamed@example.com",
            name="Renamed Learner",
        ),
        db,
        org_slug=org.slug,
    )

    assert second.id == first.id
    assert second.email == "renamed@example.com"
    assert second.first_name == "Renamed"
    assert second.last_name == "Learner"
    identity = (
        (
            await db.execute(
                select(TrellisIdentity).where(TrellisIdentity.user_id == first.id)
            )
        )
        .scalars()
        .one()
    )
    membership = (
        (
            await db.execute(
                select(UserOrganization).where(UserOrganization.user_id == first.id)
            )
        )
        .scalars()
        .one()
    )
    assert identity.trellis_subject == "0f939709-c592-4abf-9589-241ad714f8e2"
    assert membership.org_id == org.id
    assert membership.role_id == user_role.id == 4


@pytest.mark.asyncio
async def test_refuses_to_attach_an_unmapped_email_collision(
    db, org, user_role
) -> None:
    db.add(
        User(
            username="existing",
            first_name="Existing",
            last_name="User",
            email="learner@example.com",
            user_uuid="user_existing",
            creation_date="now",
            update_date="now",
        )
    )
    await db.commit()

    with pytest.raises(HTTPException) as collision:
        await provision_trellis_learner(
            TrellisAssertionClaims(
                subject="28b31e61-0d3e-428a-a6ea-96eacf5a957e",
                email="learner@example.com",
                name="Another Learner",
            ),
            db,
            org_slug=org.slug,
        )

    assert collision.value.status_code == 409


@pytest.mark.asyncio
async def test_exchange_mints_a_trellis_bound_learner_session(
    db,
    org,
    user_role,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.academy import trellis_auth

    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "learner@example.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_OWNER_EMAILS", "")
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    monkeypatch.setattr(trellis_auth, "get_redis_client", lambda: FakeRedis())
    introspect = AsyncMock(
        return_value=TrellisSubjectStatus(active=True, email="learner@example.com")
    )
    monkeypatch.setattr(trellis_auth, "introspect_trellis_identity", introspect)

    response = await trellis_auth.exchange_trellis_assertion(
        trellis_auth.TrellisExchangeRequest(
            assertion=make_assertion(
                "test-shared-secret",
                destination="/course/course-1/activity/quiz-1",
            )
        ),
        db,
    )

    access = decode_jwt(response.access_token)
    refresh = decode_jwt(response.refresh_token)
    assert access is not None
    assert refresh is not None
    assert access["trellis_sub"] == "0f939709-c592-4abf-9589-241ad714f8e2"
    assert access["amr"] == "sso"
    assert access["sorg"] == org.id
    assert access[ACADEMY_ROLE_CLAIM] == "learner"
    assert access["type"] == "access"
    assert refresh["trellis_sub"] == access["trellis_sub"]
    assert refresh[ACADEMY_ROLE_CLAIM] == "learner"
    assert refresh["type"] == "refresh"
    assert response.user.signup_method == "trellis_sso"
    assert response.academy_role == "learner"
    assert response.destination == "/course/course-1/activity/quiz-1"
    introspect.assert_awaited_once_with("0f939709-c592-4abf-9589-241ad714f8e2")

    monkeypatch.setattr(
        trellis_auth,
        "introspect_trellis_identity",
        AsyncMock(
            return_value=TrellisSubjectStatus(
                active=True, email="learner@example.com"
            )
        ),
    )
    monkeypatch.setattr(
        trellis_auth,
        "_accept_or_replay_refresh",
        lambda _user_id, _jti, proposed: proposed,
    )
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/trellis/refresh",
            "headers": [(b"cookie", f"LH_refresh={response.refresh_token}".encode())],
        }
    )

    rotated = await trellis_auth.refresh_trellis_session(request, db)
    rotated_access = decode_jwt(rotated.access_token)
    rotated_refresh = decode_jwt(rotated.refresh_token)
    assert rotated_access is not None
    assert rotated_refresh is not None
    assert rotated_access["trellis_sub"] == access["trellis_sub"]
    assert rotated_refresh["trellis_sub"] == access["trellis_sub"]
    assert rotated_access[ACADEMY_ROLE_CLAIM] == "learner"
    assert rotated_refresh[ACADEMY_ROLE_CLAIM] == "learner"
    assert rotated_access["purpose"] == "session"

    revoked: list[int] = []
    monkeypatch.setattr(trellis_auth, "revoke_user_sessions_before", revoked.append)
    logout = await trellis_auth.logout_trellis_session(
        PublicUser(**response.user.model_dump())
    )
    assert logout.status_code == 204
    assert revoked == [response.user.id]


@pytest.mark.asyncio
async def test_exchange_rejects_an_assertion_with_a_stale_authoritative_email(
    db,
    org,
    user_role,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.academy import trellis_auth

    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "michel@trellistech.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_OWNER_EMAILS", "michel@trellistech.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    monkeypatch.setattr(trellis_auth, "get_redis_client", lambda: FakeRedis())
    monkeypatch.setattr(
        trellis_auth,
        "introspect_trellis_identity",
        AsyncMock(
            return_value=TrellisSubjectStatus(
                active=True, email="former-owner@example.com"
            )
        ),
    )

    with pytest.raises(HTTPException) as stale:
        await trellis_auth.exchange_trellis_assertion(
            trellis_auth.TrellisExchangeRequest(
                assertion=make_assertion(
                    "test-shared-secret", email="michel@trellistech.com"
                )
            ),
            db,
        )

    assert stale.value.status_code == 401
    assert (await db.execute(select(User))).scalars().all() == []


@pytest.mark.asyncio
async def test_duplicate_refresh_reuses_the_same_short_lived_rotation(
    db,
    org,
    user_role,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A lost browser response must not strand an otherwise valid session."""
    from src.academy import trellis_auth

    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "learner@example.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_OWNER_EMAILS", "")
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    monkeypatch.setattr(trellis_auth, "get_redis_client", lambda: FakeRedis())
    monkeypatch.setattr(
        trellis_auth,
        "introspect_trellis_identity",
        AsyncMock(
            return_value=TrellisSubjectStatus(
                active=True, email="learner@example.com"
            )
        ),
    )
    exchanged = await trellis_auth.exchange_trellis_assertion(
        trellis_auth.TrellisExchangeRequest(
            assertion=make_assertion("test-shared-secret")
        ),
        db,
    )
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/trellis/refresh",
            "headers": [
                (b"cookie", f"LH_refresh={exchanged.refresh_token}".encode())
            ],
        }
    )
    accepted: trellis_auth.TrellisRefreshResponse | None = None

    def accept_or_replay(
        _user_id: int,
        _jti: str,
        proposed: trellis_auth.TrellisRefreshResponse,
    ) -> trellis_auth.TrellisRefreshResponse | None:
        nonlocal accepted
        if accepted is None:
            accepted = proposed
        return accepted

    monkeypatch.setattr(trellis_auth, "_accept_or_replay_refresh", accept_or_replay)

    first = await trellis_auth.refresh_trellis_session(request, db)
    replay = await trellis_auth.refresh_trellis_session(request, db)

    assert replay == first


@pytest.mark.asyncio
async def test_owner_session_keeps_the_read_only_learner_membership(
    db,
    org,
    user_role,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.academy import trellis_auth

    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "michel@trellistech.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_OWNER_EMAILS", "michel@trellistech.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_ORG_SLUG", org.slug)
    monkeypatch.setattr(trellis_auth, "get_redis_client", lambda: FakeRedis())
    monkeypatch.setattr(
        trellis_auth,
        "introspect_trellis_identity",
        AsyncMock(
            return_value=TrellisSubjectStatus(
                active=True, email="michel@trellistech.com"
            )
        ),
    )

    response = await trellis_auth.exchange_trellis_assertion(
        trellis_auth.TrellisExchangeRequest(
            assertion=make_assertion(
                "test-shared-secret", email="michel@trellistech.com"
            )
        ),
        db,
    )

    access = decode_jwt(response.access_token)
    membership = (
        (
            await db.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == response.user.id
                )
            )
        )
        .scalars()
        .one()
    )
    assert access is not None
    assert response.academy_role == "owner"
    assert access[ACADEMY_ROLE_CLAIM] == "owner"
    assert membership.role_id == 4

    owner_session = await trellis_auth.get_trellis_session(
        PublicUser(**response.user.model_dump())
    )
    assert owner_session.academy_role == "owner"
    assert owner_session.user.email == "michel@trellistech.com"


@pytest.mark.asyncio
async def test_learner_cannot_cross_the_owner_authority_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.academy import trellis_auth

    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "learner@example.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_OWNER_EMAILS", "")
    learner = PublicUser(
        id=7,
        username="learner",
        first_name="Academy",
        last_name="Learner",
        email="learner@example.com",
        user_uuid="user_learner",
        creation_date="now",
        update_date="now",
    )

    with pytest.raises(HTTPException) as forbidden:
        await trellis_auth.require_academy_owner(learner)

    assert forbidden.value.status_code == 403


@pytest.mark.asyncio
async def test_introspection_uses_the_configured_trellis_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import Mock

    from src.services.auth import trellis_sso

    response = Mock(status_code=200)
    response.json.return_value = {"active": True, "email": "michel@trellistech.com"}
    client = FakeIntrospectionClient(response)
    monkeypatch.setenv("TRELLIS_APP_URL", "https://trellis.test")
    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setattr(trellis_sso.httpx, "AsyncClient", lambda **_kwargs: client)

    assert await introspect_trellis_subject("0f939709-c592-4abf-9589-241ad714f8e2")
    assert client.request == (
        "https://trellis.test/api/academy/sso/introspect",
        {
            "headers": {"Authorization": "Bearer test-shared-secret"},
            "json": {"subject": "0f939709-c592-4abf-9589-241ad714f8e2"},
        },
    )


@pytest.mark.asyncio
async def test_refresh_rejects_stale_owner_email_until_a_fresh_exchange(
    db,
    org,
    user_role,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.academy import trellis_auth

    monkeypatch.setenv("TRELLIS_ACADEMY_ALLOWED_EMAILS", "michel@trellistech.com,new@example.com")
    monkeypatch.setenv("TRELLIS_ACADEMY_OWNER_EMAILS", "michel@trellistech.com")
    user = User(
        username="michel",
        first_name="Michel",
        last_name="Lopez",
        email="michel@trellistech.com",
        password_hash="unused",
        creation_date="now",
        update_date="now",
        user_uuid="user_michel",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    subject = "0f939709-c592-4abf-9589-241ad714f8e2"
    claims = {
        "sub": user.email,
        "purpose": "session",
        "trellis_sub": subject,
        "academy_role": "owner",
        **session_claims(AUTH_METHOD_SSO, org.id),
    }
    refresh = create_refresh_token(data=claims)
    monkeypatch.setattr(
        trellis_auth,
        "introspect_trellis_identity",
        AsyncMock(return_value=TrellisSubjectStatus(active=True, email="new@example.com")),
    )
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/trellis/refresh",
            "headers": [(b"cookie", f"LH_refresh={refresh}".encode())],
        }
    )

    with pytest.raises(HTTPException) as stale:
        await trellis_auth.refresh_trellis_session(request, db)

    assert stale.value.status_code == 401


@pytest.mark.asyncio
async def test_introspection_fails_closed_on_a_non_success_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import Mock

    from src.services.auth import trellis_sso

    response = Mock(status_code=503)
    client = FakeIntrospectionClient(response)
    monkeypatch.setenv("TRELLIS_APP_URL", "https://trellis.test")
    monkeypatch.setenv("TRELLIS_ACADEMY_SSO_SECRET", "test-shared-secret")
    monkeypatch.setattr(trellis_sso.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(HTTPException) as unavailable:
        await introspect_trellis_subject("0f939709-c592-4abf-9589-241ad714f8e2")

    assert unavailable.value.status_code == 503
