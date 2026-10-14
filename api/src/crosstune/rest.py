"""What the API's clients for other services' REST APIs share: status, timeout, and transport."""

from __future__ import annotations

import httpx2

DEFAULT_TIMEOUT_SECONDS = 10.0
SUCCESS_STATUSES = range(200, 300)
NOT_FOUND_STATUS = 404


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
