"""Clerk Backend API client, for deleting the Clerk half of an account."""

from __future__ import annotations

from typing import Protocol

import httpx2

DEFAULT_BASE_URL = "https://api.clerk.com"
DEFAULT_TIMEOUT_SECONDS = 10.0
_SUCCESS_STATUSES = range(200, 300)
_NOT_FOUND_STATUS = 404


class ClerkUsers(Protocol):
    """What `DELETE /v1/me` needs from Clerk, held on `app.state` so tests can fake it."""

    async def delete_user(self, clerk_user_id: str) -> None:
        """Delete the Clerk user. A user already gone counts as deleted, not an error."""
        ...


class ClerkUnavailableError(Exception):
    """Clerk did not confirm the delete: a non-2xx, non-404 status, or a transport failure."""


class ClerkBackendUsers:
    """Deletes a user through Clerk's Backend API."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        secret_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self._secret_key = secret_key
        self._base_url = base_url
        self._timeout = timeout

    async def delete_user(self, clerk_user_id: str) -> None:
        """Delete the Clerk user.

        Raises:
            ClerkUnavailableError: Clerk answered with anything but 2xx or 404, or the
                request itself failed (a timeout, a closed connection, and so on).
        """
        try:
            response = await self._client.delete(
                f"{self._base_url}/v1/users/{clerk_user_id}",
                headers={"Authorization": f"Bearer {self._secret_key}"},
                timeout=self._timeout,
                # The shared client follows redirects for link resolution; a delete must
                # not, since a same-origin redirect would replay as a GET with the bearer
                # header still attached and a 200 there would read as a successful delete.
                follow_redirects=False,
            )
        except httpx2.HTTPError as exc:
            raise ClerkUnavailableError from exc
        if (
            response.status_code not in _SUCCESS_STATUSES
            and response.status_code != _NOT_FOUND_STATUS
        ):
            msg = f"Clerk answered {response.status_code} deleting {clerk_user_id}"
            raise ClerkUnavailableError(msg)
