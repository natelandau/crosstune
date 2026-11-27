"""Large API responses are compressed for a client that accepts gzip."""

from __future__ import annotations

import pytest

from tests.helpers import T0, change, push, uid

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize(
    ("accept_encoding", "expected_encoding"),
    [("gzip", "gzip"), ("identity", None)],
)
async def test_a_large_pull_is_compressed_only_when_accepted(
    client, auth_headers, accept_encoding, expected_encoding
) -> None:
    headers = auth_headers("user_a")
    tunes = [change("tunes", uid(), T0, title=f"Tune {i}") for i in range(20)]
    await push(client, headers, *tunes)
    response = await client.get(
        "/v1/sync/pull?since=0", headers={**headers, "Accept-Encoding": accept_encoding}
    )
    assert response.status_code == 200
    assert response.headers.get("content-encoding") == expected_encoding
    # Every tune and the entitlements row, decoded the same either way.
    assert len(response.json()["rows"]) == len(tunes) + 1
