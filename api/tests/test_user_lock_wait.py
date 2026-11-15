"""A request that waits on its account's lock gives up and answers 429 instead of holding a connection."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, NamedTuple

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.db.locks import billing_lock, lock_clerk_user
from crosstune.models import Tune
from crosstune.models.user import User
from tests.fakes import FakeRevenueCat
from tests.helpers import (
    T0,
    T1,
    change,
    hold_account_lock,
    push,
    recording,
    uid,
    wait_for_finished,
    web_subscription,
)
from tests.test_scans_api import make_scan, put_object

if TYPE_CHECKING:
    import uuid
    from collections.abc import AsyncIterator

    import httpx2
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import AsyncEngine

    from crosstune.storage.store import ObjectInfo
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
WITHDRAW = Call("POST", "/v1/me/billing/withdraw")
DELETE_ME = Call("DELETE", "/v1/me")
# Both take the account's billing lock before its user lock.
BILLING_LOCK_CALLS = [WITHDRAW, DELETE_ME]

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
    app: FastAPI,
    client: httpx2.AsyncClient,
    auth_headers,
    object_store: FakeObjectStore,
    verify_session: AsyncSession,
) -> str:
    """The id a call names: a row the caller owns where the route checks it before locking.

    The two upload confirmations also read the bucket before they lock, so their row
    carries a real upload. A withdrawal refuses an account with nothing to withdraw before
    it locks, so the account gets a subscription.
    """
    headers = auth_headers("user_a")
    if call == WITHDRAW:
        await _subscribe(app, client, auth_headers, ["user_a"])
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


async def _subscribe(
    app: FastAPI, client: httpx2.AsyncClient, auth_headers, clerk_user_ids: list[str]
) -> None:
    """Give each account a web subscription inside its withdrawal window."""
    app.state.revenuecat = FakeRevenueCat(
        {cid: [web_subscription(subscription_id=f"sub_{cid}")] for cid in clerk_user_ids}
    )
    for clerk_user_id in clerk_user_ids:
        response = await client.post("/v1/me/billing/refresh", headers=auth_headers(clerk_user_id))
        assert response.status_code == 204, response.text


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
    target = await _target_id(call, app, client, auth_headers, object_store, verify_session)
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
    headers = auth_headers("user_a")
    user_id = await _user_id(client, headers, verify_session)
    target = await _target_id(call, app, client, auth_headers, object_store, verify_session)
    path = call.path.format(id=target)
    async with hold_account_lock(engine, user_id):
        baseline = engine.pool.checkedout()
        pending = {
            asyncio.create_task(client.request(call.method, path, json=call.body, headers=headers))
            for _ in range(CONCURRENT_REQUESTS)
        }
        try:
            async with asyncio.timeout(PROMPT):
                done, pending = await wait_for_finished(pending, CONCURRENT_REQUESTS - cap)
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
    assert checked_out <= cap
    assert other.status_code == 200, other.text
    assert app.state.locking_request_limiter.tracked == 0


@pytest.mark.parametrize(
    "call", [RECORDING_UPLOADED, SCAN_UPLOADED], ids=lambda call: f"{call.method} {call.path}"
)
async def test_a_busy_account_is_refused_before_the_bucket_read(
    app: FastAPI,
    client: httpx2.AsyncClient,
    auth_headers,
    object_store: FakeObjectStore,
    verify_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    call: Call,
) -> None:
    cap = app.state.settings.concurrent_locking_requests_per_user
    headers = auth_headers("user_a")
    await _user_id(client, headers, verify_session)
    path = call.path.format(
        id=await _target_id(call, app, client, auth_headers, object_store, verify_session)
    )
    release = asyncio.Event()
    heads: list[str] = []
    read = object_store.head

    async def held_head(key: str) -> ObjectInfo | None:
        heads.append(key)
        await release.wait()
        return await read(key)

    monkeypatch.setattr(object_store, "head", held_head)
    pending = {
        asyncio.create_task(client.request(call.method, path, headers=headers))
        for _ in range(CONCURRENT_REQUESTS)
    }
    try:
        async with asyncio.timeout(PROMPT):
            done, pending = await wait_for_finished(pending, CONCURRENT_REQUESTS - cap)
        assert {task.result().status_code for task in done} == {429}
        assert len(heads) == cap
    finally:
        release.set()
        await asyncio.gather(*pending, return_exceptions=True)


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
    target = await _target_id(call, app, client, auth_headers, object_store, verify_session)
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
    object_store: FakeObjectStore,
    verify_session: AsyncSession,
    call: Call,
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"request_lock_timeout_seconds": 0.2})
    headers = auth_headers("user_a")
    user_id = await _user_id(client, headers, verify_session)
    await _target_id(call, app, client, auth_headers, object_store, verify_session)
    async with AsyncSession(bind=engine) as holder, billing_lock(holder, user_id):
        response = await asyncio.wait_for(
            client.request(call.method, call.path, json=call.body, headers=headers), timeout=5
        )
    assert response.status_code == 429, response.text
    assert int(response.headers["Retry-After"]) >= 1


SMALL_POOL = 3
# Above BURST_PROMPT, so a request that waits out a checkout fails the test.
POOL_TIMEOUT = 6.0
BURST_PROMPT = 3.0


@pytest.fixture
async def small_pool(app: FastAPI, settings) -> AsyncIterator[None]:
    """Serve the app from a pool as small as SMALL_POOL, with no overflow."""
    engine = make_engine(
        settings.database_url, pool_size=SMALL_POOL, max_overflow=0, pool_timeout=POOL_TIMEOUT
    )
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    yield
    await engine.dispose()


class Burst(NamedTuple):
    """A call that accounts send all at once, and the status each one answers."""

    call: Call
    subscribed: bool
    status: int


BURSTS = [
    # Refused before any lock.
    Burst(WITHDRAW, subscribed=False, status=409),
    Burst(WITHDRAW, subscribed=True, status=204),
    Burst(DELETE_ME, subscribed=False, status=204),
]


@pytest.mark.parametrize("burst", BURSTS, ids=lambda b: f"{b.call.method} {b.call.path} {b.status}")
@pytest.mark.usefixtures("small_pool")
async def test_billing_lock_requests_from_as_many_accounts_as_the_pool_holds_answer_at_once(
    app: FastAPI, client: httpx2.AsyncClient, auth_headers, burst: Burst
) -> None:
    accounts = [f"user_{n}" for n in range(SMALL_POOL)]
    for clerk_user_id in [*accounts, "user_bystander"]:
        response = await client.get("/v1/me", headers=auth_headers(clerk_user_id))
        assert response.status_code == 200, response.text
    if burst.subscribed:
        await _subscribe(app, client, auth_headers, accounts)

    calls = [
        client.request(burst.call.method, burst.call.path, headers=auth_headers(clerk_user_id))
        for clerk_user_id in accounts
    ]
    bystander = client.get("/v1/me", headers=auth_headers("user_bystander"))
    *responses, other = await asyncio.wait_for(
        asyncio.gather(*calls, bystander), timeout=BURST_PROMPT
    )

    assert [r.status_code for r in responses] == [burst.status] * SMALL_POOL
    assert other.status_code == 200, other.text


async def test_a_new_account_s_first_request_behind_its_clerk_lock_answers_429(
    app: FastAPI,
    client: httpx2.AsyncClient,
    auth_headers,
    engine: AsyncEngine,
    verify_session: AsyncSession,
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"request_lock_timeout_seconds": 0.2})
    async with AsyncSession(bind=engine) as holder:
        await lock_clerk_user(holder, "user_new")
        try:
            response = await asyncio.wait_for(
                client.get("/v1/me", headers=auth_headers("user_new")), timeout=5
            )
        finally:
            await holder.rollback()
    assert response.status_code == 429, response.text
    assert int(response.headers["Retry-After"]) >= 1
    created = await verify_session.scalar(select(User.id).where(User.clerk_user_id == "user_new"))
    assert created is None


async def test_a_push_statement_behind_a_held_row_lock_answers_429(
    app: FastAPI,
    client: httpx2.AsyncClient,
    auth_headers,
    engine: AsyncEngine,
) -> None:
    app.state.settings = app.state.settings.model_copy(
        update={"push_statement_timeout_seconds": 0.2}
    )
    headers = auth_headers("user_a")
    tune_id = uid()
    await push(client, headers, change("tunes", tune_id, T0, title="Sally Ann"))
    async with AsyncSession(bind=engine) as holder:
        await holder.execute(select(Tune).where(Tune.id == tune_id).with_for_update())
        try:
            response = await asyncio.wait_for(
                client.post(
                    "/v1/sync/push",
                    json={"changes": [change("tunes", tune_id, T1, title="Sally Gal")]},
                    headers=headers,
                ),
                timeout=PROMPT,
            )
        finally:
            await holder.rollback()
    assert response.status_code == 429, response.text
    assert int(response.headers["Retry-After"]) >= 1
