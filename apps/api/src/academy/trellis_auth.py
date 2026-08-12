import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.core.redis import get_redis_client
from src.db.organizations import Organization
from src.db.users import PublicUser, User, UserRead
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.security.auth import (
    JWT_REFRESH_COOKIE_NAME,
    JWT_REFRESH_TOKEN_EXPIRES,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    revoke_user_sessions_before,
)
from src.security.session_context import (
    AUTH_METHOD_SSO,
    carry_session_claims,
    session_claims,
)
from src.services.auth.trellis_sso import (
    ACADEMY_ROLE_CLAIM,
    AcademyRole,
    academy_role_for_email,
    introspect_trellis_identity,
    provision_trellis_learner,
    verify_and_consume_assertion,
)

router = APIRouter()
logger = logging.getLogger(__name__)

REFRESH_RECOVERY_SECONDS = 5
_REFRESH_ROTATION_SCRIPT = """
local claimed = redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1])
if claimed then
  redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[2])
  return ARGV[3]
end
return redis.call('GET', KEYS[2])
"""


class TrellisExchangeRequest(BaseModel):
    assertion: str


class TrellisExchangeResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserRead
    org_id: int
    destination: str
    academy_role: AcademyRole


class TrellisRefreshResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TrellisSessionResponse(BaseModel):
    user: UserRead
    academy_role: AcademyRole


def _accept_or_replay_refresh(
    user_id: int,
    jti: str,
    proposed: TrellisRefreshResponse,
) -> TrellisRefreshResponse | None:
    """Atomically accept a rotation or recover its briefly lost response.

    Browsers can abandon an in-flight response during navigation after the API
    has consumed the single-use refresh token. A five-second recovery record
    lets that same token receive the exact already-issued successor once; after
    the window, the token remains a rejected replay for its full lifetime.
    """
    redis_client = get_redis_client()
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Academy session store unavailable")

    encoded = proposed.model_dump_json()
    try:
        result = redis_client.eval(
            _REFRESH_ROTATION_SCRIPT,
            2,
            f"refresh_used:{user_id}:{jti}",
            f"academy_refresh_recovery:{user_id}:{jti}",
            int(JWT_REFRESH_TOKEN_EXPIRES.total_seconds()),
            REFRESH_RECOVERY_SECONDS,
            encoded,
        )
    except Exception as error:
        logger.error("Academy refresh rotation store failed", exc_info=error)
        raise HTTPException(
            status_code=503, detail="Academy session store unavailable"
        ) from error

    if result is None:
        return None
    if isinstance(result, bytes):
        result = result.decode("utf-8")
    try:
        return TrellisRefreshResponse.model_validate(json.loads(result))
    except (TypeError, ValueError) as error:
        logger.error("Academy refresh recovery record is invalid", exc_info=error)
        raise HTTPException(
            status_code=503, detail="Academy session store unavailable"
        ) from error


@router.post("/exchange", response_model=TrellisExchangeResponse)
async def exchange_trellis_assertion(
    body: TrellisExchangeRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> TrellisExchangeResponse:
    org_slug = os.environ.get("TRELLIS_ACADEMY_ORG_SLUG", "").strip()
    if not org_slug:
        raise HTTPException(
            status_code=503, detail="Trellis Academy organization is unavailable"
        )

    claims = verify_and_consume_assertion(body.assertion, get_redis_client())
    status = await introspect_trellis_identity(claims.subject)
    if (
        not status.active
        or status.email is None
        or str(status.email).strip().lower() != claims.email.strip().lower()
    ):
        raise HTTPException(status_code=401, detail="Trellis identity is unavailable")
    user = await provision_trellis_learner(claims, db_session, org_slug=org_slug)
    organization = (
        (
            await db_session.execute(
                select(Organization).where(Organization.slug == org_slug)
            )
        )
        .scalars()
        .first()
    )
    if organization is None or organization.id is None:
        raise HTTPException(
            status_code=503, detail="Trellis Academy organization is unavailable"
        )

    token_claims = {
        "sub": str(user.email),
        "purpose": "session",
        "trellis_sub": claims.subject,
        ACADEMY_ROLE_CLAIM: academy_role_for_email(str(user.email)),
        **session_claims(AUTH_METHOD_SSO, organization.id),
    }
    return TrellisExchangeResponse(
        access_token=create_access_token(data=token_claims),
        refresh_token=create_refresh_token(data=token_claims),
        user=user,
        org_id=organization.id,
        destination=claims.destination,
        academy_role=token_claims[ACADEMY_ROLE_CLAIM],
    )


@router.post("/refresh", response_model=TrellisRefreshResponse)
async def refresh_trellis_session(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
) -> TrellisRefreshResponse:
    credentials_error = HTTPException(
        status_code=401, detail="Could not validate credentials"
    )
    token = request.cookies.get(JWT_REFRESH_COOKIE_NAME)
    payload = decode_refresh_token(token) if token else None
    if not payload or payload.get("purpose") != "session":
        raise credentials_error

    email = payload.get("sub")
    trellis_subject = payload.get("trellis_sub")
    jti = payload.get("jti")
    if (
        not isinstance(email, str)
        or not isinstance(trellis_subject, str)
        or not isinstance(jti, str)
    ):
        raise credentials_error

    user = (
        (await db_session.execute(select(User).where(User.email == email)))
        .scalars()
        .first()
    )
    if user is None or user.id is None:
        raise credentials_error
    status = await introspect_trellis_identity(trellis_subject)
    if (
        not status.active
        or status.email is None
        or str(status.email).strip().lower() != email.strip().lower()
    ):
        revoke_user_sessions_before(user.id)
        raise credentials_error

    carried = {
        **carry_session_claims(payload),
        "trellis_sub": trellis_subject,
        ACADEMY_ROLE_CLAIM: academy_role_for_email(email),
        "purpose": "session",
    }
    proposed = TrellisRefreshResponse(
        access_token=create_access_token(data={"sub": email, **carried}),
        refresh_token=create_refresh_token(data={"sub": email, **carried}),
    )
    accepted = _accept_or_replay_refresh(user.id, jti, proposed)
    if accepted is None:
        raise credentials_error
    return accepted


@router.get("/session", response_model=TrellisSessionResponse)
async def get_trellis_session(
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
) -> TrellisSessionResponse:
    return TrellisSessionResponse(
        user=UserRead.model_validate(current_user),
        academy_role=academy_role_for_email(str(current_user.email)),
    )


async def require_academy_owner(
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
) -> PublicUser:
    if academy_role_for_email(str(current_user.email)) != "owner":
        raise HTTPException(status_code=403, detail="Academy owner access required")
    return current_user


@router.delete("/logout", status_code=204)
async def logout_trellis_session(
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
) -> Response:
    revoke_user_sessions_before(current_user.id)
    return Response(status_code=204)
