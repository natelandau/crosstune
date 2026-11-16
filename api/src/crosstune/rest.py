"""What the API's REST clients for other services share: status, timeout, transport, waits."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

import httpx2

if TYPE_CHECKING:
    from collections.abc import Callable

DEFAULT_TIMEOUT_SECONDS = 10.0
SUCCESS_STATUSES = range(200, 300)
NOT_FOUND_STATUS = 404

# A service that limits us without saying for how long is left alone for a minute.
DEFAULT_WAIT_SECONDS = 60.0
# A longer wait than this is most likely a misreported header, not a real ban.
MAX_WAIT_SECONDS = 300.0


def wait_seconds(retry_after: str | None) -> float:
    """Read a Retry-After header as seconds, kept within the default and the cap.

    Args:
        retry_after: The header's value, if any. Only the seconds form is read.

    Returns:
        float: Seconds to leave the service alone.
    """
    value = (retry_after or "").strip()
    # isdigit alone passes digits such as "²" that float() refuses.
    if not (value.isascii() and value.isdigit()):
        return DEFAULT_WAIT_SECONDS
    return min(max(float(value), 1.0), MAX_WAIT_SECONDS)


class RateLimitHold:
    """When a service that rate-limited a shared credential may be called again.

    Every user shares the credential, so one 429 holds the service for everyone in this
    process. Calling it again before then only extends the limit.
    """

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._until = 0.0

    def hold(self, seconds: float) -> None:
        """Leave the service alone for the given number of seconds from now."""
        self._until = max(self._until, self._clock() + seconds)

    def hold_if_limited(self, response: httpx2.Response) -> float | None:
        """Hold the service for the response's Retry-After when it is a 429.

        Returns:
            float | None: The seconds held, or None when the response is not a rate limit.
        """
        if response.status_code != httpx2.codes.TOO_MANY_REQUESTS:
            return None
        seconds = wait_seconds(response.headers.get("Retry-After"))
        self.hold(seconds)
        return seconds

    @property
    def held(self) -> bool:
        """Whether the service is still waiting out a limit."""
        return self._clock() < self._until


async def send_bearer(  # noqa: PLR0913 -- one keyword per request part a client may send
    client: httpx2.AsyncClient,
    method: str,
    url: str,
    *,
    token: str,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
    unavailable: type[Exception],
    headers: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
    data: dict[str, str] | None = None,
    json: object = None,
) -> httpx2.Response:
    """Send one request authorized by a bearer token, leaving the status to the caller.

    The shared client follows redirects for link resolution. Here none is followed: a
    redirect would replay the bearer header against whatever it names, and a same-origin
    one could turn a write into a GET whose 200 reads as success.

    Args:
        client: The shared outbound client.
        method: The HTTP method.
        url: The full request URL.
        token: The bearer token for the Authorization header.
        timeout: The per-request timeout in seconds.
        unavailable: The caller's error for a request that never got an answer.
        headers: Headers to send beside the Authorization header.
        params: Query parameters.
        data: A form body.
        json: A JSON body.

    Returns:
        httpx2.Response: The answer, whatever its status.

    Raises:
        unavailable: The request failed before any answer, such as on a timeout.
    """
    try:
        return await client.request(
            method,
            url,
            headers={"Authorization": f"Bearer {token}", **(headers or {})},
            params=params,
            data=data,
            json=json,
            timeout=timeout,
            follow_redirects=False,
        )
    except httpx2.HTTPError as exc:
        raise unavailable from exc
