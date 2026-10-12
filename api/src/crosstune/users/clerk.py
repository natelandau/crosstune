"""Clerk Backend API client, for deleting the Clerk half of an account and looking up a user."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Protocol

import httpx2

from crosstune.rest import DEFAULT_TIMEOUT_SECONDS, NOT_FOUND_STATUS, SUCCESS_STATUSES

DEFAULT_BASE_URL = "https://api.clerk.com"
# Checked before the ID goes into a URL path, so no input can reach another endpoint.
_USER_ID = re.compile(r"user_[A-Za-z0-9]+")


class ClerkUsers(Protocol):
    """What account deletion and inactivity warnings need from Clerk, held on `app.state`."""

    async def delete_user(self, clerk_user_id: str) -> None:
        """Delete the Clerk user. A user already gone counts as deleted, not an error."""
        ...

    async def find_user(self, account: str) -> ClerkUser | None:
        """Look up a user by email address or Clerk user ID, or None when there is none."""
        ...


@dataclass(frozen=True)
class ClerkUser:
    """A Clerk user: its id and primary email address, if it has any."""

    id: str
    email: str | None


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
            response.status_code not in SUCCESS_STATUSES
            and response.status_code != NOT_FOUND_STATUS
        ):
            msg = f"Clerk answered {response.status_code} deleting {clerk_user_id}"
            raise ClerkUnavailableError(msg)

    async def find_user(self, account: str) -> ClerkUser | None:
        """Look up a Clerk user by email address or Clerk user ID, never creating one.

        Args:
            account: An email address (contains `@`) or a Clerk user ID (`user_...`).

        Returns:
            ClerkUser | None: The user, or None when Clerk has no such user.

        Raises:
            ValueError: `account` is neither an email address nor a Clerk user ID.
            ClerkUnavailableError: Clerk answered with anything but 2xx or, for an ID, 404,
                the request itself failed, or the answer is not a user.
        """
        if "@" in account:
            found = await self._send("GET", params={"email_address": account})
            if not isinstance(found, list):
                msg = "Clerk sent an unexpected user list payload"
                raise ClerkUnavailableError(msg)
            return _clerk_user(found[0]) if found else None
        if _USER_ID.fullmatch(account):
            user = await self._send("GET", f"/{account}", allow_not_found=True)
            return None if user is None else _clerk_user(user)
        msg = f"{account} is neither a Clerk user ID (user_...) nor an email"
        raise ValueError(msg)

    async def _send(
        self, method: str, suffix: str = "", *, allow_not_found: bool = False, **kwargs: Any
    ) -> Any:
        path = f"/v1/users{suffix}"
        try:
            response = await self._client.request(
                method,
                f"{self._base_url}{path}",
                headers={"Authorization": f"Bearer {self._secret_key}"},
                timeout=self._timeout,
                follow_redirects=False,
                **kwargs,
            )
        except httpx2.HTTPError as exc:
            raise ClerkUnavailableError from exc
        if allow_not_found and response.status_code == NOT_FOUND_STATUS:
            return None
        if response.status_code not in SUCCESS_STATUSES:
            msg = f"Clerk answered {response.status_code} to {method} {path}"
            raise ClerkUnavailableError(msg)
        try:
            return response.json()
        except ValueError as exc:
            msg = f"Clerk answered {method} {path} with a body that is not JSON"
            raise ClerkUnavailableError(msg) from exc


def _clerk_user(user: Any) -> ClerkUser:
    """Build a `ClerkUser` from a Clerk user object, preferring the primary address.

    Raises:
        ClerkUnavailableError: The object has no string id.
    """
    if not isinstance(user, dict) or not isinstance(user.get("id"), str):
        msg = "Clerk sent an unexpected user payload"
        raise ClerkUnavailableError(msg)
    entries = [
        entry
        for entry in user.get("email_addresses") or []
        if isinstance(entry, dict) and isinstance(entry.get("email_address"), str)
    ]
    primary_id = user.get("primary_email_address_id")
    chosen = next((e for e in entries if e.get("id") == primary_id), None)
    if chosen is None and entries:
        chosen = entries[0]
    return ClerkUser(user["id"], chosen["email_address"] if chosen else None)
