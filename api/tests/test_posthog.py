"""PostHog person deletion over the bulk delete endpoint."""

import json

import httpx2
import pytest

from crosstune.analytics.posthog import AnalyticsUnavailableError, PostHogPersons

BULK_DELETE_URL = "https://us.posthog.com/api/projects/123/persons/bulk_delete/"
DELETE_KEY = "phx_test"

pytestmark = pytest.mark.anyio


async def test_delete_person_posts_bulk_delete(mock_http) -> None:
    mock_http.add(BULK_DELETE_URL, httpx2.Response(202, json={"persons_found": 1}))
    client = mock_http.client()
    try:
        await PostHogPersons(client, "123", DELETE_KEY).delete_person("user_abc")
    finally:
        await client.aclose()
    request = mock_http.calls[-1]
    assert request.method == "POST"
    assert str(request.url) == BULK_DELETE_URL
    assert request.headers["authorization"] == f"Bearer {DELETE_KEY}"
    assert json.loads(request.content) == {
        "distinct_ids": ["user_abc"],
        "delete_events": True,
        "delete_recordings": True,
    }


async def test_delete_person_with_no_person_found_succeeds(mock_http) -> None:
    mock_http.add(
        BULK_DELETE_URL,
        httpx2.Response(202, json={"persons_found": 0, "persons_deleted": 0}),
    )
    client = mock_http.client()
    try:
        await PostHogPersons(client, "123", DELETE_KEY).delete_person("user_abc")
    finally:
        await client.aclose()


@pytest.mark.parametrize("status", [401, 500])
async def test_delete_person_non_2xx_raises(mock_http, status: int) -> None:
    mock_http.add(BULK_DELETE_URL, httpx2.Response(status))
    client = mock_http.client()
    try:
        with pytest.raises(AnalyticsUnavailableError):
            await PostHogPersons(client, "123", DELETE_KEY).delete_person("user_abc")
    finally:
        await client.aclose()


async def test_delete_person_does_not_follow_a_redirect(mock_http) -> None:
    mock_http.add(
        BULK_DELETE_URL,
        httpx2.Response(302, headers={"location": "https://us.posthog.com/elsewhere"}),
    )
    mock_http.add("https://us.posthog.com/elsewhere", httpx2.Response(200))
    client = mock_http.client()
    try:
        with pytest.raises(AnalyticsUnavailableError):
            await PostHogPersons(client, "123", DELETE_KEY).delete_person("user_abc")
    finally:
        await client.aclose()


async def test_delete_person_transport_error_raises() -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        msg = "connection refused"
        raise httpx2.ConnectError(msg, request=request)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(refuse))
    try:
        with pytest.raises(AnalyticsUnavailableError):
            await PostHogPersons(client, "123", DELETE_KEY).delete_person("user_abc")
    finally:
        await client.aclose()


async def test_delete_person_with_deletion_errors_raises(mock_http) -> None:
    mock_http.add(
        BULK_DELETE_URL,
        httpx2.Response(
            202,
            json={
                "persons_found": 1,
                "persons_deleted": 0,
                "deletion_errors": [{"distinct_id": "user_abc", "error": "lock timeout"}],
            },
        ),
    )
    client = mock_http.client()
    try:
        with pytest.raises(AnalyticsUnavailableError, match="lock timeout"):
            await PostHogPersons(client, "123", DELETE_KEY).delete_person("user_abc")
    finally:
        await client.aclose()


async def test_delete_person_with_empty_deletion_errors_succeeds(mock_http) -> None:
    mock_http.add(
        BULK_DELETE_URL,
        httpx2.Response(
            202, json={"persons_found": 1, "persons_deleted": 1, "deletion_errors": []}
        ),
    )
    client = mock_http.client()
    try:
        await PostHogPersons(client, "123", DELETE_KEY).delete_person("user_abc")
    finally:
        await client.aclose()


async def test_a_base_url_with_a_trailing_slash_posts_to_the_same_endpoint(mock_http) -> None:
    mock_http.add(BULK_DELETE_URL, httpx2.Response(202, json={"persons_found": 1}))
    client = mock_http.client()
    try:
        await PostHogPersons(
            client, "123", DELETE_KEY, base_url="https://us.posthog.com/"
        ).delete_person("user_abc")
    finally:
        await client.aclose()
    assert str(mock_http.calls[-1].url) == BULK_DELETE_URL
