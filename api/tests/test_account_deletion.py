"""DELETE /v1/me: the endpoint that owns account deletion."""

from __future__ import annotations

import asyncio
import json
import uuid

import httpx2
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.locks import lock_user
from crosstune.errors import ACCOUNT_DELETED_PROBLEM, PROBLEM_JSON
from crosstune.models import (
    DeletedAccount,
    Job,
    List,
    ListItem,
    PlayEvent,
    PracticeSession,
    Recording,
    RecordingLink,
    RecordingLoop,
    ScanView,
    StatusChange,
    Tune,
    UploadSlot,
    User,
    UserSettings,
    UserTune,
)
from crosstune.users.clerk import ClerkBackendUsers, ClerkUnavailableError
from tests.fakes import FakeObjectStore
from tests.helpers import T0, change, push, sign, uid
from tests.helpers import recording as recording_change

pytestmark = pytest.mark.anyio

CLERK_USERS_URL = "https://api.clerk.com/v1/users/"


async def _seed(
    client: httpx2.AsyncClient, auth_headers, verify_session: AsyncSession, clerk_user_id: str
) -> str:
    """A user with one row in every table it owns. Returns the user's id."""
    me = (await client.get("/v1/me", headers=auth_headers(clerk_user_id))).json()
    tune, user_tune, lst, rec = uid(), uid(), uid(), uid()
    await push(
        client,
        auth_headers(clerk_user_id),
        change("tunes", tune, T0, title="Angeline the Baker"),
        change("user_tunes", user_tune, T0, tune_id=tune, status="known"),
        change("lists", lst, T0, name="Set"),
        change("list_items", uid(), T0, list_id=lst, user_tune_id=user_tune),
        change(
            "recording_links",
            uid(),
            T0,
            tune_id=tune,
            url="https://example.com/take",
            provider="other",
            title="A take",
        ),
        change("user_settings", uid(), T0, instruments=["violin"]),
        recording_change(rec),
        change(
            "recording_loops",
            uid(),
            T0,
            recording_id=rec,
            label="A part",
            start_ms=0,
            end_ms=4000,
            color=1,
        ),
        change(
            "play_events",
            uid(),
            T0,
            recording_id=rec,
            context="row",
            started_at=T0.isoformat(),
            listened_ms=30_000,
        ),
        change(
            "practice_sessions",
            uid(),
            T0,
            recording_id=rec,
            started_at=T0.isoformat(),
            duration_ms=60_000,
            speed_percent=75,
            pitch_cents=0,
        ),
        change(
            "scan_views",
            uid(),
            T0,
            tune_id=tune,
            context="tune",
            started_at=T0.isoformat(),
            viewed_ms=8_000,
        ),
    )
    # Jobs and upload slots are server bookkeeping that no push creates directly.
    user_id = uuid.UUID(me["id"])
    verify_session.add_all(
        [
            Job(recording_id=uuid.UUID(rec), user_id=user_id),
            UploadSlot(
                recording_id=uuid.UUID(rec),
                user_id=user_id,
                declared_bytes=1,
                content_type="audio/mp4",
                expires_at=T0,
            ),
        ]
    )
    await verify_session.commit()
    return me["id"]


async def test_delete_me_removes_everything_and_the_clerk_user(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    user_id = await _seed(client, auth_headers, verify_session, "user_a")
    owned = (
        User,
        UserSettings,
        Tune,
        UserTune,
        List,
        ListItem,
        Recording,
        RecordingLink,
        RecordingLoop,
        PlayEvent,
        PracticeSession,
        ScanView,
        StatusChange,
        Job,
        UploadSlot,
    )
    for model in owned:
        assert await verify_session.scalar(select(func.count()).select_from(model)) == 1, model
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.clerk_users.deleted == ["user_a"]
    for model in owned:
        assert await verify_session.scalar(select(func.count()).select_from(model)) == 0, model
    assert await verify_session.get(DeletedAccount, "user_a") is not None
    assert app.state.object_store.deleted_prefixes == [f"{user_id}/"]


class _CommitCheckingStore(FakeObjectStore):
    """Records whether the user row was already committed away when the purge ran."""

    def __init__(self, engine, clerk_user_id: str) -> None:
        super().__init__()
        self._engine = engine
        self._clerk_user_id = clerk_user_id
        self.row_gone_at_purge: bool | None = None

    async def delete_prefix(self, prefix: str) -> None:
        async with AsyncSession(bind=self._engine) as s:
            row = await s.scalar(select(User).where(User.clerk_user_id == self._clerk_user_id))
        self.row_gone_at_purge = row is None
        await super().delete_prefix(prefix)


async def test_delete_me_commits_before_the_purge_runs(
    engine, client: httpx2.AsyncClient, app, auth_headers
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    store = _CommitCheckingStore(engine, "user_a")
    app.state.object_store = store
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert store.row_gone_at_purge is True


async def test_webhook_commits_before_the_purge_runs(
    engine, client: httpx2.AsyncClient, app, auth_headers
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    store = _CommitCheckingStore(engine, "user_a")
    app.state.object_store = store
    body = json.dumps({"type": "user.deleted", "data": {"id": "user_a"}}).encode()
    response = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))
    assert response.status_code == 204
    assert store.row_gone_at_purge is True


async def test_delete_me_rolls_back_when_clerk_fails(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    app.state.clerk_users.error = ClerkUnavailableError()
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 502
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1
    assert await verify_session.scalar(select(func.count()).select_from(DeletedAccount)) == 0
    assert app.state.object_store.deleted_prefixes == []


async def test_delete_me_succeeds_when_clerk_user_already_gone(
    client: httpx2.AsyncClient, app, auth_headers, mock_http, verify_session: AsyncSession
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    mock_http.add(f"{CLERK_USERS_URL}user_a", httpx2.Response(404))
    app.state.clerk_users = ClerkBackendUsers(app.state.http_client, "sk_test_fixture")
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 0


async def test_delete_me_without_secret_answers_503_and_changes_nothing(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    app.state.clerk_users = None
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 503
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1


async def test_token_after_delete_gets_the_account_deleted_problem(
    client: httpx2.AsyncClient, auth_headers
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    await client.delete("/v1/me", headers=auth_headers("user_a"))
    for response in (
        await client.get("/v1/me", headers=auth_headers("user_a")),
        await client.get("/v1/sync/pull", headers=auth_headers("user_a")),
    ):
        assert response.status_code == 401
        assert response.headers["content-type"] == PROBLEM_JSON
        assert response.json()["type"] == ACCOUNT_DELETED_PROBLEM


async def test_an_invalid_token_is_not_the_account_deleted_problem(
    client: httpx2.AsyncClient,
) -> None:
    response = await client.get("/v1/me", headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401
    assert response.json()["type"] == "about:blank"


async def test_webhook_after_delete_is_a_no_op(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert len(app.state.object_store.deleted_prefixes) == 1
    user_count = await verify_session.scalar(select(func.count()).select_from(User))
    denylist_count = await verify_session.scalar(select(func.count()).select_from(DeletedAccount))

    body = json.dumps({"type": "user.deleted", "data": {"id": "user_a"}}).encode()
    response = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))

    assert response.status_code == 204
    # The webhook's own purge_account call finds no row, so it schedules no second wipe.
    assert len(app.state.object_store.deleted_prefixes) == 1
    assert await verify_session.scalar(select(func.count()).select_from(User)) == user_count
    assert (
        await verify_session.scalar(select(func.count()).select_from(DeletedAccount))
        == denylist_count
    )


async def test_concurrent_deletes_call_clerk_once(
    engine, client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    """Both deletes queue on lock_user; only the one that finds the row calls Clerk."""
    clerk_user_id = "user_racing"
    me = (await client.get("/v1/me", headers=auth_headers(clerk_user_id))).json()
    user_id = uuid.UUID(me["id"])

    async with engine.connect() as lock_conn:
        lock_trans = await lock_conn.begin()
        lock_session = AsyncSession(
            bind=lock_conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            await lock_user(lock_session, user_id)

            first = asyncio.create_task(
                client.delete("/v1/me", headers=auth_headers(clerk_user_id))
            )
            second = asyncio.create_task(
                client.delete("/v1/me", headers=auth_headers(clerk_user_id))
            )
            await asyncio.sleep(0.1)
            assert not first.done()
            assert not second.done()

            # Releasing this transaction is what frees the advisory lock for both deletes.
            await lock_trans.commit()
            responses = await asyncio.wait_for(asyncio.gather(first, second), timeout=5)
        finally:
            await lock_session.close()

    statuses = {response.status_code for response in responses}
    assert statuses <= {204, 401}
    assert app.state.clerk_users.deleted == ["user_racing"]
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 0


async def test_clerk_backend_users_sends_delete_with_the_bearer_header(mock_http) -> None:
    mock_http.add(f"{CLERK_USERS_URL}user_a", httpx2.Response(200))
    client = mock_http.client()
    try:
        users = ClerkBackendUsers(client, "sk_test_secret")  # gitleaks:allow -- fixture
        await users.delete_user("user_a")
    finally:
        await client.aclose()
    request = mock_http.calls[-1]
    assert request.method == "DELETE"
    assert str(request.url) == f"{CLERK_USERS_URL}user_a"
    assert request.headers["authorization"] == "Bearer sk_test_secret"


async def test_clerk_backend_users_treats_404_as_success(mock_http) -> None:
    mock_http.add(f"{CLERK_USERS_URL}user_a", httpx2.Response(404))
    client = mock_http.client()
    try:
        users = ClerkBackendUsers(client, "sk_test_secret")  # gitleaks:allow -- fixture
        await users.delete_user("user_a")  # does not raise
    finally:
        await client.aclose()


async def test_clerk_backend_users_does_not_follow_a_redirect(mock_http) -> None:
    mock_http.add(
        f"{CLERK_USERS_URL}user_a",
        httpx2.Response(302, headers={"location": "https://api.clerk.com/v1/users/user_a/x"}),
    )
    client = mock_http.client()
    try:
        users = ClerkBackendUsers(client, "sk_test_secret")  # gitleaks:allow -- fixture
        with pytest.raises(ClerkUnavailableError):
            await users.delete_user("user_a")
    finally:
        await client.aclose()
    # Not followed: exactly the one DELETE, never a GET on the redirect target.
    assert len(mock_http.calls) == 1


async def test_clerk_backend_users_5xx_raises_clerk_unavailable(mock_http) -> None:
    mock_http.add(f"{CLERK_USERS_URL}user_a", httpx2.Response(500))
    client = mock_http.client()
    try:
        users = ClerkBackendUsers(client, "sk_test_secret")  # gitleaks:allow -- fixture
        with pytest.raises(ClerkUnavailableError):
            await users.delete_user("user_a")
    finally:
        await client.aclose()


async def test_clerk_backend_users_transport_error_raises_clerk_unavailable() -> None:
    def boom(request: httpx2.Request) -> httpx2.Response:
        msg = "no route to host"
        raise httpx2.ConnectError(msg)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(boom))
    try:
        users = ClerkBackendUsers(client, "sk_test_secret")  # gitleaks:allow -- fixture
        with pytest.raises(ClerkUnavailableError):
            await users.delete_user("user_a")
    finally:
        await client.aclose()
