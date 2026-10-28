"""A request that waits on its account's lock gives up and answers 429 instead of holding a connection."""

from __future__ import annotations

import asyncio
import uuid
from typing import TYPE_CHECKING, NamedTuple

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.locks import advisory_lock_key, billing_lock
from crosstune.models.user import User
from tests.helpers import push, recording, uid
from tests.test_scans_api import make_scan, put_object

if TYPE_CHECKING:
    import httpx2
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import AsyncEngine

    from tests.fakes import FakeObjectStore

pytestmark = pytest.mark.anyio


class Call(NamedTuple):
    """One request a client can send while another request holds the account's lock."""

    method: str
    path: str
    body: dict | None = None


LOCKING_CALLS = [
    Call("POST", "/v1/sync/push", {"changes": []}),
    Call("GET", "/v1/sync/pull"),
    Call("GET", "/v1/sync/events"),
    Call("POST", "/v1/me/notices", {"notice": "first_recording"}),
    Call("POST", "/v1/recordings/{id}/upload-slot", {"bytes": 1000, "content_type": "audio/mp4"}),
    Call("POST", "/v1/recordings/{id}/uploaded"),
    Call("POST", "/v1/recordings/{id}/retry"),
    Call("POST", "/v1/scans/{id}/upload-slot", {"bytes": 1000, "content_type": "image/jpeg"}),
    Call("POST", "/v1/scans/{id}/uploaded"),
    Call("POST", "/v1/me/billing/refresh"),
    Call("POST", "/v1/me/billing/withdraw"),
    Call("DELETE", "/v1/me"),
]

# Both take the account's billing lock before its user lock.
BILLING_LOCK_CALLS = LOCKING_CALLS[-2:]

# These two read the row and the bucket before they lock, so they need a real upload.
UPLOADED_RECORDING = "/v1/recordings/{id}/uploaded"
UPLOADED_SCAN = "/v1/scans/{id}/uploaded"


async def _target_id(
    path: str,
    client: httpx2.AsyncClient,
    auth_headers,
    object_store: FakeObjectStore,
    verify_session: AsyncSession,
) -> str:
    headers = auth_headers("user_a")
    if path == UPLOADED_RECORDING:
        rec = uid()
        await push(client, headers, recording(rec))
        response = await client.post(
            f"/v1/recordings/{rec}/upload-slot",
            json={"bytes": 3, "content_type": "audio/mp4"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        object_store.put_bytes(object_store.presigned[-1][1], b"abc", "audio/mp4")
        return rec
    if path == UPLOADED_SCAN:
        _, scan_id = await make_scan(client, auth_headers)
        response = await client.post(
            f"/v1/scans/{scan_id}/upload-slot",
            json={"bytes": 3, "content_type": "image/jpeg"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        await put_object(object_store, verify_session, scan_id, 3)
        return scan_id
    return uid()


SYNC_CALLS = LOCKING_CALLS[:3]


async def _user_id(
    client: httpx2.AsyncClient, headers: dict, verify_session: AsyncSession
) -> uuid.UUID:
    response = await client.get("/v1/me", headers=headers)
    assert response.status_code == 200, response.text
    user_id = await verify_session.scalar(select(User.id).where(User.clerk_user_id == "user_a"))
    assert user_id is not None
    return user_id


@pytest.mark.parametrize("call", LOCKING_CALLS, ids=lambda call: f"{call.method} {call.path}")
async def test_a_request_behind_a_held_account_lock_answers_429(
    app: FastAPI,
    client: httpx2.AsyncClient,
    auth_headers,
    engine: AsyncEngine,
    object_store: FakeObjectStore,
    verify_session: AsyncSession,
    call: Call,
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"request_lock_timeout_seconds": 0.2})
    headers = auth_headers("user_a")
    user_id = await _user_id(client, headers, verify_session)
    target = await _target_id(call.path, client, auth_headers, object_store, verify_session)
    async with engine.connect() as holder:
        await holder.begin()
        await holder.execute(select(func.pg_advisory_xact_lock(advisory_lock_key(user_id))))
        try:
            # Without a bound the request would wait for the holder for as long as it holds.
            response = await asyncio.wait_for(
                client.request(
                    call.method, call.path.format(id=target), json=call.body, headers=headers
                ),
                timeout=5,
            )
        finally:
            await holder.rollback()
    assert response.status_code == 429, response.text
    assert int(response.headers["Retry-After"]) >= 1


@pytest.mark.parametrize("call", SYNC_CALLS, ids=lambda call: f"{call.method} {call.path}")
async def test_a_sync_request_past_the_account_s_concurrent_limit_answers_429(
    app: FastAPI, client: httpx2.AsyncClient, auth_headers, call: Call
) -> None:
    headers = auth_headers("user_a")
    me = await client.get("/v1/me", headers=headers)
    user_id = uuid.UUID(me.json()["id"])
    limiter = app.state.sync_request_limiter
    held = 0
    while limiter.try_acquire(user_id):
        held += 1
    try:
        response = await client.request(call.method, call.path, json=call.body, headers=headers)
    finally:
        for _ in range(held):
            limiter.release(user_id)
    assert held == app.state.settings.concurrent_sync_requests_per_user
    assert response.status_code == 429, response.text
    assert int(response.headers["Retry-After"]) >= 1


async def test_a_finished_sync_request_frees_its_place_under_the_limit(
    app: FastAPI, client: httpx2.AsyncClient, auth_headers
) -> None:
    headers = auth_headers("user_a")
    for _ in range(app.state.settings.concurrent_sync_requests_per_user + 2):
        response = await client.get("/v1/sync/pull", headers=headers)
        assert response.status_code == 200, response.text
    assert app.state.sync_request_limiter.tracked == 0


@pytest.mark.parametrize("call", BILLING_LOCK_CALLS, ids=lambda call: f"{call.method} {call.path}")
async def test_a_request_behind_a_held_billing_lock_answers_429(
    app: FastAPI,
    client: httpx2.AsyncClient,
    auth_headers,
    engine: AsyncEngine,
    verify_session: AsyncSession,
    call: Call,
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"request_lock_timeout_seconds": 0.2})
    headers = auth_headers("user_a")
    user_id = await _user_id(client, headers, verify_session)
    async with AsyncSession(bind=engine) as holder, billing_lock(holder, user_id):
        response = await asyncio.wait_for(
            client.request(call.method, call.path, json=call.body, headers=headers), timeout=5
        )
    assert response.status_code == 429, response.text
    assert int(response.headers["Retry-After"]) >= 1
