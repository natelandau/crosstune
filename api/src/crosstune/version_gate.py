"""Turn away Apple builds below the supported version before anything else runs."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from starlette.requests import Request

from crosstune.auth.deps import verify_bearer
from crosstune.body import API_PREFIX, WEBHOOK_PREFIX
from crosstune.client_sightings import SIGHTING_USER_STATE_KEY, record_sighting
from crosstune.client_version import ClientVersion, client_version, is_blocked
from crosstune.db.base import utc_now
from crosstune.errors import AppError, UpdateRequiredError, problem_response
from crosstune.models import User

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger(__name__)


class VersionGate:
    """Answer an Apple build below the floor with 426, recording the version it reported.

    Plain ASGI and outermost, so a blocked request is answered before its body is
    admitted or read and before any route or dependency runs. An accepted request's
    version is recorded after the app returns, once its own session has closed, so the
    write never holds a second pooled connection beside it.
    """

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Pass the request on, or answer it with an update-required problem."""
        path: str = scope.get("path", "")
        if (
            scope["type"] != "http"
            or not path.startswith(API_PREFIX)
            or path.startswith(WEBHOOK_PREFIX)
        ):
            await self._app(scope, receive, send)
            return
        request = Request(scope)
        client = client_version(request.headers)
        if client is None:
            await self._app(scope, receive, send)
            return
        state = request.app.state
        if is_blocked(client, state.settings.apple_min):
            await _record_blocked(request, client)
            await problem_response(UpdateRequiredError())(scope, receive, send)
            return
        # Shared with the app below, which may otherwise start its own state dict.
        request_state: dict = scope.setdefault("state", {})
        await self._app(scope, receive, send)
        user_id = request_state.get(SIGHTING_USER_STATE_KEY)
        if user_id is not None:
            await record_sighting(
                state.sessionmaker, state.client_sightings, user_id, client, utc_now()
            )


async def _record_blocked(request: Request, client: ClientVersion) -> None:
    """Record a blocked build against its account, if the caller is a known account.

    The caller is never provisioned here, and no failure changes the answer it gets.
    """
    try:
        claims = await verify_bearer(request)
    except AppError as exc:
        logger.debug("not recording a blocked build: %s", exc.detail)
        return
    state = request.app.state
    sightings = state.client_sightings
    clerk_user_id = claims["sub"]
    user_id = sightings.account(clerk_user_id)
    if user_id is None:
        try:
            async with state.sessionmaker() as session:
                user_id = await session.scalar(
                    select(User.id).where(User.clerk_user_id == clerk_user_id)
                )
        except SQLAlchemyError:
            logger.warning("could not look up the blocked caller's account", exc_info=True)
            return
        if user_id is None:
            return
        sightings.remember_account(clerk_user_id, user_id)
    await record_sighting(state.sessionmaker, sightings, user_id, client, utc_now())
