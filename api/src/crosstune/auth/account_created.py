"""The response header that tells a client its request created the account."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING

from starlette.datastructures import MutableHeaders

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

ACCOUNT_CREATED_HEADER = "X-Account-Created"

# Where `current_user` records that it created the account, and as which kind.
ACCOUNT_CREATED_STATE_KEY = "account_created"


class AccountCreatedHeader:
    """Add `X-Account-Created` to the response of the request that created the account.

    Plain ASGI rather than `BaseHTTPMiddleware`, which would buffer streamed bodies.
    """

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Set the header on a successful response when `current_user` flagged the request.

        An error response skips it: the session rolls back on a raised error, so the
        user row it created is gone and the next request creates the account again.
        """
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if (
                message["type"] == "http.response.start"
                and message["status"] < HTTPStatus.BAD_REQUEST
            ):
                kind = scope.get("state", {}).get(ACCOUNT_CREATED_STATE_KEY)
                if kind:
                    MutableHeaders(scope=message)[ACCOUNT_CREATED_HEADER] = kind
            await send(message)

        await self._app(scope, receive, send_with_header)
