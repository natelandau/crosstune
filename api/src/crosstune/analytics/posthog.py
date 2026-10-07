"""PostHog API client, for deleting a person's analytics data when their account is deleted."""

from __future__ import annotations

from typing import Protocol

import httpx2

DEFAULT_BASE_URL = "https://us.posthog.com"
DEFAULT_TIMEOUT_SECONDS = 10.0
_SUCCESS_STATUSES = range(200, 300)


class AnalyticsPersons(Protocol):
    """What account deletion needs from the analytics service, held on `app.state` so tests can fake it."""

    async def delete_person(self, distinct_id: str) -> None:
        """Delete the person with this distinct ID, with their events and recordings.

        A person the service has never seen counts as deleted, not an error.
        """
        ...


class AnalyticsUnavailableError(Exception):
    """PostHog did not confirm the delete: a non-2xx status, or a transport failure."""


class PostHogPersons:
    """Deletes a person through PostHog's bulk delete endpoint."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        project_id: str,
        delete_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self._project_id = project_id
        self._delete_key = delete_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def delete_person(self, distinct_id: str) -> None:
        """Delete the person, their events, and their recordings.

        Raises:
            AnalyticsUnavailableError: PostHog answered with anything but 2xx, reported
                deletion errors, or the request itself failed (a timeout, a closed
                connection, and so on).
        """
        try:
            response = await self._client.post(
                f"{self._base_url}/api/projects/{self._project_id}/persons/bulk_delete/",
                headers={"Authorization": f"Bearer {self._delete_key}"},
                json={
                    "distinct_ids": [distinct_id],
                    "delete_events": True,
                    "delete_recordings": True,
                },
                timeout=self._timeout,
                # The shared client follows redirects for link resolution; a redirect
                # would replay the bearer header against another address.
                follow_redirects=False,
            )
        except httpx2.HTTPError as exc:
            raise AnalyticsUnavailableError from exc
        if response.status_code not in _SUCCESS_STATUSES:
            msg = f"PostHog answered {response.status_code} deleting {distinct_id}"
            raise AnalyticsUnavailableError(msg)
        # A failed delete still answers 202, naming what it could not delete.
        errors = _deletion_errors(response)
        if errors:
            msg = f"PostHog could not delete {distinct_id}: {errors}"
            raise AnalyticsUnavailableError(msg)


def _deletion_errors(response: httpx2.Response) -> object:
    """The `deletion_errors` of a bulk delete answer, or None when it names none."""
    try:
        body = response.json()
    except ValueError:
        return None
    return body.get("deletion_errors") if isinstance(body, dict) else None
