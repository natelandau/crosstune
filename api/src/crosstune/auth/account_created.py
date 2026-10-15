"""The response header that tells a client its request created the account."""

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.datastructures import MutableHeaders

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

ACCOUNT_CREATED_HEADER = "X-Account-Created"


class AccountCreatedHeader:
    """Add `X-Account-Created` to the response of the request that created the account.

    Plain ASGI rather than `BaseHTTPMiddleware`, which would buffer streamed bodies.
    """

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Set the header on the response start when `current_user` flagged the request."""
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                started = scope.get("state", {}).get("account_created")
                if started:
                    MutableHeaders(scope=message)[ACCOUNT_CREATED_HEADER] = started
            await send(message)

        await self._app(scope, receive, send_with_header)
