"""Request body admission: who may send one, and how large.

FastAPI reads and parses a route's whole body before any dependency runs, so the
bearer token dependency alone would let an anonymous caller make the API buffer a
body of any size. This middleware checks the token and the size first.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.exceptions import HTTPException
from starlette.requests import Request

from crosstune.auth.deps import CLAIMS_STATE_KEY, verify_bearer
from crosstune.errors import AppError, problem_response

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

WEBHOOK_MAX_BODY_BYTES = 65_536
WEBHOOK_PREFIX = "/v1/webhooks/"
API_PREFIX = "/v1/"
TOO_LARGE_DETAIL = "Request body is too large"


class BodyTooLargeError(AppError):
    """The request body is over the limit for its route."""

    def __init__(self) -> None:
        super().__init__(413, "Content Too Large", TOO_LARGE_DETAIL)


class BodyAdmission:
    """Refuse a body from an unverified caller, and any body over its route's limit."""

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Admit the request, or answer it with a problem before its body is read."""
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return
        request = Request(scope)
        declared = _declared_length(request)
        if not declared and "transfer-encoding" not in request.headers:
            # No body is coming, so there is nothing to guard; the route's own
            # dependencies authenticate it.
            await self._app(scope, receive, send)
            return
        path: str = scope["path"]
        limit = (
            WEBHOOK_MAX_BODY_BYTES
            if path.startswith(WEBHOOK_PREFIX)
            else request.app.state.settings.max_request_body_bytes
        )
        try:
            if declared > limit:
                raise BodyTooLargeError
            if path.startswith(API_PREFIX) and not path.startswith(WEBHOOK_PREFIX):
                scope.setdefault("state", {})[CLAIMS_STATE_KEY] = await verify_bearer(request)
        except AppError as exc:
            await problem_response(exc)(scope, receive, send)
            return
        await self._app(scope, _capped(receive, limit), send)


def _declared_length(request: Request) -> int:
    try:
        return int(request.headers.get("content-length", "0"))
    except ValueError:
        return 0


def _capped(receive: Receive, limit: int) -> Receive:
    """Wrap `receive` so a body without a truthful length still stops at the limit."""
    received = 0

    async def capped() -> Message:
        nonlocal received
        message = await receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > limit:
                # FastAPI re-raises an HTTPException from a body read and wraps anything
                # else as a 400, so this is the type that reaches the handler as a 413.
                raise HTTPException(413, TOO_LARGE_DETAIL)
        return message

    return capped
