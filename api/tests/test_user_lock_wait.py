"""A request that waits on its account's lock gives up and answers 429 instead of holding a connection."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, NamedTuple

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.locks import billing_lock
from crosstune.models.user import User
from tests.helpers import hold_account_lock, push, recording, uid
from tests.test_scans_api import make_scan, put_object

if TYPE_CHECKING:
    import uuid

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


PULL = Call("GET", "/v1/sync/pull")
NOTICE = Call("POST", "/v1/me/notices", {"notice": "first_recording"})
RECORDING_SLOT = Call(
    "POST", "/v1/recordings/{id}/upload-slot", {"bytes": 1000, "content_type": "audio/mp4"}
)
RECORDING_UPLOADED = Call("POST", "/v1/recordings/{id}/uploaded")
RETRY = Call("POST", "/v1/recordings/{id}/retry")
SCAN_SLOT = Call(
    "POST", "/v1/scans/{id}/upload-slot", {"bytes": 1000, "content_type": "image/jpeg"}
)
SCAN_UPLOADED = Call("POST", "/v1/scans/{id}/uploaded")
# Both take the account's billing lock before its user lock.
BILLING_LOCK_CALLS = [
    Call("POST", "/v1/me/billing/withdraw"),
    Call("DELETE", "/v1/me"),
]

LOCKING_CALLS = [
    Call("POST", "/v1/sync/push", {"changes": []}),
    PULL,
    Call("GET", "/v1/sync/events"),
    NOTICE,
    RECORDING_SLOT,
    RECORDING_UPLOADED,
    RETRY,
    SCAN_SLOT,
    SCAN_UPLOADED,
    Call("POST", "/v1/me/billing/refresh"),
    *BILLING_LOCK_CALLS,
]

UPLOAD_SLOT_CALLS = [RECORDING_SLOT, SCAN_SLOT]


async def _target_id(
    call: Call,
    client: httpx2.AsyncClient,
    auth_headers,
    object_store: FakeObjectStore,
    verify_session: AsyncSession,
) -> str:
    """The id a call names: a row the caller owns where the route checks it before locking.

    The two upload confirmations also read the bucket before they lock, so their row
    carries a real upload.
    """
    headers = auth_headers("user_a")
    if call in (RECORDING_SLOT, RECORDING_UPLOADED, RETRY):
        rec = uid()
        await push(client, headers, recording(rec))
        if call == RECORDING_UPLOADED:
            response = await client.post(
                f"/v1/recordings/{rec}/upload-slot",
                json={"bytes": 3, "content_type": "audio/mp4"},
                headers=headers,
            )
            assert response.status_code == 200, response.text
            object_store.put_bytes(object_store.presigned[-1][1], b"abc", "audio/mp4")
        return rec
    if call in (SCAN_SLOT, SCAN_UPLOADED):
        _, scan_id = await make_scan(client, auth_headers)
        if call == SCAN_UPLOADED:
            response = await client.post(
                f"/v1/scans/{scan_id}/upload-slot",
                json={"bytes": 3, "content_type": "image/jpeg"},
                headers=headers,
            )
            assert response.status_code == 200, response.text
            await put_object(object_store, verify_session, scan_id, 3)
        return scan_id
    return uid()


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
    target = await _target_id(call, client, auth_headers, object_store, verify_session)
    async with hold_account_lock(engine, user_id):
        # Without a bound the request would wait for the holder for as long as it holds.
        response = await asyncio.wait_for(
            client.request(
                call.method, call.path.format(id=target), json=call.body, headers=headers
            ),
            timeout=5,
        )
    assert response.status_code == 429, response.text
    assert int(response.headers["Retry-After"]) >= 1


# The default pool's size plus its overflow, so without a per-account cap these requests
# would hold every connection.
CONCURRENT_REQUESTS = 15
# Seconds a test waits for what must happen at once; far below the lock timeout, so a
# request that waited on the lock fails the test.
PROMPT = 10
LONG_LOCK_TIMEOUT = 60.0


@pytest.mark.parametrize("call", LOCKING_CALLS, ids=lambda call: f"{call.method} {call.path}")
async def test_requests_past_the_account_s_concurrent_limit_answer_429_at_once(
    app: FastAPI,
    client: httpx2.AsyncClient,
    auth_headers,
    engine: AsyncEngine,
    object_store: FakeObjectStore,
    verify_session: AsyncSession,
    call: Call,
) -> None:
    app.state.settings = app.state.settings.model_copy(
        update={"request_lock_timeout_seconds": LONG_LOCK_TIMEOUT}
    )
    cap = app.state.settings.concurrent_locking_requests_per_user
    # While one request holds the billing lock and waits on the user lock, it holds that
    # lock's connection and its session's.
    allowed = cap + 1 if call in BILLING_LOCK_CALLS else cap
    headers = auth_headers("user_a")
    user_id = await _user_id(client, headers, verify_session)
    target = await _target_id(call, client, auth_headers, object_store, verify_session)
    path = call.path.format(id=target)
    async with hold_account_lock(engine, user_id):
        baseline = engine.pool.checkedout()
        pending = {
            asyncio.create_task(client.request(call.method, path, json=call.body, headers=headers))
            for _ in range(CONCURRENT_REQUESTS)
        }
        done: set[asyncio.Task] = set()
        try:
            async with asyncio.timeout(PROMPT):
                while len(done) < CONCURRENT_REQUESTS - cap:
                    finished, pending = await asyncio.wait(
                        pending, return_when=asyncio.FIRST_COMPLETED
                    )
                    done |= finished
            checked_out = engine.pool.checkedout() - baseline
            other = await asyncio.wait_for(
                client.get("/v1/me", headers=auth_headers("user_b")), timeout=PROMPT
            )
        finally:
            # Releasing the lock lets the admitted requests finish.
            release = asyncio.gather(*pending, return_exceptions=True)
    await release
    assert len(pending) == cap
    for task in done:
        response = task.result()
        assert response.status_code == 429, response.text
        assert int(response.headers["Retry-After"]) >= 1
    assert checked_out <= allowed
    assert other.status_code == 200, other.text
    assert app.state.locking_request_limiter.tracked == 0


class Finished(NamedTuple):
    """A request that finishes inside the account's limit, and the status it answers."""

    call: Call
    status: int


FINISHED_CALLS = [
    Finished(PULL, 200),
    Finished(NOTICE, 204),
    # A pending recording is not failed, so the retry is refused under the lock.
    Finished(RETRY, 409),
]


@pytest.mark.parametrize(
    "finished", FINISHED_CALLS, ids=lambda f: f"{f.call.method} {f.call.path} {f.status}"
)
async def test_a_finished_request_frees_its_place_under_the_limit(
    app: FastAPI,
    client: httpx2.AsyncClient,
    auth_headers,
    object_store: FakeObjectStore,
    verify_session: AsyncSession,
    finished: Finished,
) -> None:
    headers = auth_headers("user_a")
    call = finished.call
    target = await _target_id(call, client, auth_headers, object_store, verify_session)
    for _ in range(app.state.settings.concurrent_locking_requests_per_user + 2):
        response = await client.request(
            call.method, call.path.format(id=target), json=call.body, headers=headers
        )
        assert response.status_code == finished.status, response.text
    assert app.state.locking_request_limiter.tracked == 0


@pytest.mark.parametrize("call", UPLOAD_SLOT_CALLS, ids=lambda call: call.path)
async def test_an_upload_slot_for_a_row_the_caller_does_not_own_answers_404_at_once(
    app: FastAPI,
    client: httpx2.AsyncClient,
    auth_headers,
    engine: AsyncEngine,
    verify_session: AsyncSession,
    call: Call,
) -> None:
    app.state.settings = app.state.settings.model_copy(
        update={"request_lock_timeout_seconds": LONG_LOCK_TIMEOUT}
    )
    headers = auth_headers("user_a")
    user_id = await _user_id(client, headers, verify_session)
    async with hold_account_lock(engine, user_id):
        response = await asyncio.wait_for(
            client.request(
                call.method, call.path.format(id=uid()), json=call.body, headers=headers
            ),
            timeout=PROMPT,
        )
    assert response.status_code == 404, response.text


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
