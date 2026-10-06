"""Clerk Backend API client, for deleting the Clerk half of an account and finding a user."""

from __future__ import annotations

from typing import Any, Protocol

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

    async def find_or_create_user(self, email: str) -> str:
        """Return the id of the Clerk user with this address, creating one without a password if absent.

        Lets a local tool stand up a known account on a development instance; a
        `+clerk_test` address signs in with Clerk's fixed test code.

        Args:
            email: The address to look up, and to create the user with.

        Returns:
            str: The Clerk user id.

        Raises:
            ClerkUnavailableError: Clerk answered with anything but 2xx, the request
                itself failed, or the answer is not a user with this address.
        """
        found = await self._send("GET", params={"email_address": email})
        if not isinstance(found, list):
            msg = "Clerk sent an unexpected user list payload"
            raise ClerkUnavailableError(msg)
        if found:
            return _user_id(found[0], email)
        created = await self._send(
            "POST", json={"email_address": [email], "skip_password_requirement": True}
        )
        return _user_id(created, email)

    async def _send(self, method: str, **kwargs: Any) -> Any:
        try:
            response = await self._client.request(
                method,
                f"{self._base_url}/v1/users",
                headers={"Authorization": f"Bearer {self._secret_key}"},
                timeout=self._timeout,
                follow_redirects=False,
                **kwargs,
            )
        except httpx2.HTTPError as exc:
            raise ClerkUnavailableError from exc
        if response.status_code not in _SUCCESS_STATUSES:
            msg = f"Clerk answered {response.status_code} to {method} /v1/users"
            raise ClerkUnavailableError(msg)
        try:
            return response.json()
        except ValueError as exc:
            msg = f"Clerk answered {method} /v1/users with a body that is not JSON"
            raise ClerkUnavailableError(msg) from exc


def _user_id(user: Any, email: str) -> str:
    """The id of a Clerk user object, checked to carry `email`.

    Raises:
        ClerkUnavailableError: The object has no string id, or none of its addresses is
            `email`.
    """
    if not isinstance(user, dict) or not isinstance(user.get("id"), str):
        msg = "Clerk sent an unexpected user payload"
        raise ClerkUnavailableError(msg)
    addresses = [
        entry.get("email_address")
        for entry in user.get("email_addresses") or []
        if isinstance(entry, dict)
    ]
    if email not in addresses:
        msg = f"Clerk user {user['id']} does not have the address {email}"
        raise ClerkUnavailableError(msg)
    return user["id"]
