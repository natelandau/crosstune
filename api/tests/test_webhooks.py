"""Clerk webhook verification and account deletion."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import TYPE_CHECKING

import httpx2
import pytest
from sqlalchemy import select

from crosstune.auth.webhooks import verify_svix_signature
from crosstune.models import Song, User
from tests.fakes import FakeObjectStore
from tests.test_push import T0, change, push, uid

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio

SECRET = "whsec_dGVzdHNlY3JldHRlc3RzZWNyZXQ="  # gitleaks:allow -- fixture, not a real secret
WRONG_SECRET = (
    "whsec_d3JvbmdzZWNyZXR3cm9uZ3NlY3JldA=="  # gitleaks:allow -- fixture, not a real secret
)


class _PurgeFailsStore(FakeObjectStore):
    """A store that fails when delete_prefix is called."""

    async def delete_prefix(self, prefix: str) -> None:
        """Simulate a storage failure."""
        msg = "bucket down"
        raise RuntimeError(msg)


def sign(
    body: bytes, secret: str = SECRET, msg_id: str = "msg_1", ts: int | None = None
) -> dict[str, str]:
    ts = ts or int(time.time())
    key = base64.b64decode(secret.removeprefix("whsec_"))
    signed = f"{msg_id}.{ts}.".encode() + body
    sig = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    return {"svix-id": msg_id, "svix-timestamp": str(ts), "svix-signature": f"v1,{sig}"}


def test_valid_signature_verifies() -> None:
    body = b'{"type":"user.deleted"}'
    assert verify_svix_signature(SECRET, sign(body), body) is True


def test_tampered_body_fails() -> None:
    body = b'{"type":"user.deleted"}'
    assert verify_svix_signature(SECRET, sign(body), b'{"type":"user.created"}') is False


def test_stale_timestamp_fails() -> None:
    body = b"{}"
    assert verify_svix_signature(SECRET, sign(body, ts=int(time.time()) - 600), body) is False


def test_multiple_signatures_any_match() -> None:
    body = b"{}"
    headers = sign(body)
    headers["svix-signature"] = "v1,bogus " + headers["svix-signature"]
    assert verify_svix_signature(SECRET, headers, body) is True


def test_non_ascii_signature_fails() -> None:
    body = b"{}"
    headers = sign(body)
    headers["svix-signature"] = "v1,\xe9"
    assert verify_svix_signature(SECRET, headers, body) is False


async def test_user_deleted_purges_account_and_data(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song = uid()
    await push(client, auth_headers("user_gone"), change("songs", song, T0, title="X"))
    body = json.dumps(
        {"type": "user.deleted", "data": {"id": "user_gone", "deleted": True}}
    ).encode()
    response = await client.post(
        "/v1/webhooks/clerk",
        content=body,
        headers={**sign(body), "content-type": "application/json"},
    )
    assert response.status_code == 204
    assert (
        await verify_session.scalar(select(User).where(User.clerk_user_id == "user_gone")) is None
    )
    assert await verify_session.get(Song, uuid.UUID(song)) is None


async def test_bad_signature_is_401(client) -> None:
    body = b'{"type":"user.deleted","data":{"id":"user_x"}}'
    headers = sign(body, secret=WRONG_SECRET)
    response = await client.post("/v1/webhooks/clerk", content=body, headers=headers)
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")


async def test_other_events_are_acknowledged(client) -> None:
    body = b'{"type":"user.created","data":{"id":"user_y"}}'
    response = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))
    assert response.status_code == 204


async def test_non_ascii_signature_header_is_401(client) -> None:
    body = b"{}"
    headers = sign(body)
    # Raw byte header tuples bypass httpx's ascii-only str encoding, so the server sees
    # the same non-ASCII value a hostile client could actually put on the wire.
    raw_headers = [
        (b"svix-id", headers["svix-id"].encode()),
        (b"svix-timestamp", headers["svix-timestamp"].encode()),
        (b"svix-signature", b"v1,\xe9"),
    ]
    response = await client.post("/v1/webhooks/clerk", content=body, headers=raw_headers)
    assert response.status_code == 401


async def test_signed_null_body_is_acknowledged(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_kept"))
    body = b"null"
    response = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))
    assert response.status_code == 204
    assert await verify_session.scalar(select(User).where(User.clerk_user_id == "user_kept"))


async def test_signed_non_json_body_is_acknowledged(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_kept"))
    body = b"not json"
    response = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))
    assert response.status_code == 204
    assert await verify_session.scalar(select(User).where(User.clerk_user_id == "user_kept"))


async def test_user_deleted_purges_their_objects(client, auth_headers, object_store) -> None:
    me = (await client.get("/v1/me", headers=auth_headers("user_gone"))).json()
    object_store.put_bytes(f"{me['id']}/r1/playback.m4a", b"a", "audio/mp4")
    object_store.put_bytes("someone-else/r1/playback.m4a", b"b", "audio/mp4")
    body = json.dumps({"type": "user.deleted", "data": {"id": "user_gone"}}).encode()
    response = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))
    assert response.status_code == 204
    assert object_store.keys() == ["someone-else/r1/playback.m4a"]


async def test_user_deleted_purge_fails_leaves_user_in_place(
    app,
    auth_headers,
    truncate_all: None,
    verify_session: AsyncSession,
) -> None:
    """Store failure rolls back the user deletion so Clerk can retry both operations."""
    app.state.object_store = _PurgeFailsStore()
    transport = httpx2.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx2.AsyncClient(transport=transport, base_url="http://testclient") as client:
        await client.get("/v1/me", headers=auth_headers("user_gone"))
        body = json.dumps({"type": "user.deleted", "data": {"id": "user_gone"}}).encode()
        response = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))

    assert response.status_code == 500
    assert (
        await verify_session.scalar(select(User).where(User.clerk_user_id == "user_gone"))
        is not None
    )


async def test_user_deleted_with_no_store(
    app, auth_headers, truncate_all: None, verify_session: AsyncSession
) -> None:
    """When store is unavailable, the user is deleted and webhook succeeds."""
    app.state.object_store = None
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as client:
        await client.get("/v1/me", headers=auth_headers("user_gone"))
        body = json.dumps({"type": "user.deleted", "data": {"id": "user_gone"}}).encode()
        response = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))

    assert response.status_code == 204
    assert (
        await verify_session.scalar(select(User).where(User.clerk_user_id == "user_gone")) is None
    )
