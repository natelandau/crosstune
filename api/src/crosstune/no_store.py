"""Keep every API response out of browser, proxy, and client disk caches."""

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.datastructures import MutableHeaders

from crosstune.body import API_PREFIX

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send


class NoStore:
    """Mark every `/v1/` response, error responses included, `Cache-Control: no-store`.

    API responses carry a user's private data, so no cache may write them to disk. A
    route that sets its own `Cache-Control` keeps it. Plain ASGI rather than
    `BaseHTTPMiddleware`, which would buffer streamed bodies.
    """

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Add the header to the response start of an API request."""
        if scope["type"] != "http" or not scope["path"].startswith(API_PREFIX):
            await self._app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).setdefault("Cache-Control", "no-store")
            await send(message)

        await self._app(scope, receive, send_with_header)
