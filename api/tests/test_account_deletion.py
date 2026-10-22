"""DELETE /v1/me: the endpoint that owns account deletion."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import timedelta

import httpx2
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.billing import closing
from crosstune.billing.emails import notice_key
from crosstune.billing.grants import PaidSubscription
from crosstune.billing.revenuecat import RevenueCatUnavailableError
from crosstune.billing.stripe import StripeUnavailableError
from crosstune.billing.withdrawal import complete_pending_withdrawals
from crosstune.db.base import utc_now
from crosstune.db.locks import lock_user
from crosstune.email.resend import MailerUnavailableError
from crosstune.errors import ACCOUNT_DELETED_PROBLEM, PROBLEM_JSON
from crosstune.models import (
    AccountNotice,
    DeletedAccount,
    Grant,
    InactivityNotice,
    Job,
    List,
    ListItem,
    Place,
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
from crosstune.users.apple import AppleClient, AppleRevokeError
from crosstune.users.clerk import ClerkBackendUsers, ClerkUnavailableError
from crosstune.users.router import DeleteMeRequest
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantSource
from tests.fakes import (
    FakeAppleSignIn,
    FakeClerkUsers,
    FakeObjectStore,
    FakeRevenueCat,
    FakeStripe,
)
from tests.helpers import T0, change, push, sign, uid
from tests.helpers import recording as recording_change

pytestmark = pytest.mark.anyio

EMAIL = "player@example.com"
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
        change("places", uid(), T0, name="Porch", lat=36.66, lon=-80.92),
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
    # Jobs, upload slots, and inactivity notices are server bookkeeping that no push creates.
    user_id = uuid.UUID(me["id"])
    verify_session.add_all(
        [
            Job(recording_id=uuid.UUID(rec), user_id=user_id),
            UploadSlot(
                recording_id=uuid.UUID(rec),
                user_id=user_id,
                declared_bytes=1,
                content_type="audio/mp4",
                object_key="staged",
                expires_at=T0,
            ),
            InactivityNotice(
                user_id=user_id,
                active_since=T0,
                first_sent_at=T0,
                second_sent_at=None,
                deletion_due_at=T0 + timedelta(days=30),
            ),
            AccountNotice(user_id=user_id, notice_key="terms-2027-04", sent_at=T0),
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
        Place,
        PlayEvent,
        PracticeSession,
        ScanView,
        StatusChange,
        Job,
        UploadSlot,
        InactivityNotice,
        AccountNotice,
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


class _OrderedClerkUsers(FakeClerkUsers):
    """Records its delete in a list shared with the Apple fake."""

    def __init__(self, events: list[str], **kwargs) -> None:
        super().__init__(**kwargs)
        self.events = events

    async def delete_user(self, clerk_user_id: str) -> None:
        await super().delete_user(clerk_user_id)
        self.events.append("clerk")


CODE_BODY = {"apple_authorization_code": "c1"}


async def test_delete_without_a_body_never_calls_apple(
    client: httpx2.AsyncClient, app, auth_headers
) -> None:
    app.state.clerk_users.apple_ids = {"user_a": frozenset({"001.abc"})}
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.apple_sign_in.calls == []


class _CommitCheckingApple(FakeAppleSignIn):
    """Records whether the user row was already committed away when the revoke ran."""

    def __init__(self, engine, clerk_user_id: str, events: list[str]) -> None:
        super().__init__(events)
        self._engine = engine
        self._clerk_user_id = clerk_user_id
        self.row_gone_at_revoke: bool | None = None

    async def revoke(
        self, code: str, apple_user_ids: frozenset[str], *, client: AppleClient
    ) -> None:
        async with AsyncSession(bind=self._engine) as s:
            row = await s.scalar(select(User).where(User.clerk_user_id == self._clerk_user_id))
        self.row_gone_at_revoke = row is None
        await super().revoke(code, apple_user_ids, client=client)


async def test_delete_with_a_code_revokes_after_the_clerk_delete_and_commit(
    engine, client: httpx2.AsyncClient, app, auth_headers
) -> None:
    events: list[str] = []
    apple = _CommitCheckingApple(engine, "user_a", events)
    app.state.apple_sign_in = apple
    app.state.clerk_users = _OrderedClerkUsers(events, apple_ids={"user_a": frozenset({"001.abc"})})
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.request(
        "DELETE", "/v1/me", headers=auth_headers("user_a"), json=CODE_BODY
    )
    assert response.status_code == 204
    assert apple.calls == [("c1", frozenset({"001.abc"}), "app")]
    assert events == ["clerk", "apple"]
    assert apple.row_gone_at_revoke is True


async def test_a_web_code_revokes_as_the_web_client(
    client: httpx2.AsyncClient, app, auth_headers
) -> None:
    app.state.clerk_users.apple_ids = {"user_a": frozenset({"001.abc"})}
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.request(
        "DELETE",
        "/v1/me",
        headers=auth_headers("user_a"),
        json={**CODE_BODY, "apple_client": "web"},
    )
    assert response.status_code == 204
    assert app.state.apple_sign_in.calls == [("c1", frozenset({"001.abc"}), "web")]


async def test_an_unknown_apple_client_is_refused_and_deletes_nothing(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    app.state.clerk_users.apple_ids = {"user_a": frozenset({"001.abc"})}
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.request(
        "DELETE",
        "/v1/me",
        headers=auth_headers("user_a"),
        json={**CODE_BODY, "apple_client": "app.crosstune.other"},
    )
    assert response.status_code == 422
    assert await verify_session.scalar(select(User).where(User.clerk_user_id == "user_a"))
    assert app.state.clerk_users.deleted == []
    assert app.state.apple_sign_in.calls == []


def test_the_request_repr_hides_the_code() -> None:
    body = DeleteMeRequest(apple_authorization_code="SECRETCODE")
    assert "SECRETCODE" not in repr(body)
    assert "SECRETCODE" not in str(body)


async def test_a_failed_revoke_still_deletes(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, caplog
) -> None:
    app.state.clerk_users.apple_ids = {"user_a": frozenset({"001.abc"})}
    app.state.apple_sign_in.error = AppleRevokeError("revoke", "invalid_request")
    await client.get("/v1/me", headers=auth_headers("user_a"))
    with caplog.at_level(logging.INFO):
        response = await client.request(
            "DELETE", "/v1/me", headers=auth_headers("user_a"), json=CODE_BODY
        )
    assert response.status_code == 204
    assert app.state.clerk_users.deleted == ["user_a"]
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 0
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert errors[0].step == "revoke"
    assert errors[0].apple_error == "invalid_request"
    assert errors[0].exc_info is None
    assert "c1" not in caplog.text


async def test_an_unexpected_revoke_error_still_deletes(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, caplog
) -> None:
    app.state.clerk_users.apple_ids = {"user_a": frozenset({"001.abc"})}
    app.state.apple_sign_in.error = RuntimeError("boom c1")
    await client.get("/v1/me", headers=auth_headers("user_a"))
    with caplog.at_level(logging.INFO):
        response = await client.request(
            "DELETE", "/v1/me", headers=auth_headers("user_a"), json=CODE_BODY
        )
    assert response.status_code == 204
    assert app.state.clerk_users.deleted == ["user_a"]
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 0
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert errors[0].step == "unexpected"
    assert errors[0].exc_info is None


async def test_an_overlong_code_is_refused(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.request(
        "DELETE",
        "/v1/me",
        headers=auth_headers("user_a"),
        json={"apple_authorization_code": "x" * 513},
    )
    assert response.status_code == 422
    assert app.state.clerk_users.deleted == []
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1


async def test_clerk_read_failure_skips_the_revoke_but_deletes(
    client: httpx2.AsyncClient, app, auth_headers, caplog
) -> None:
    app.state.clerk_users.apple_error = ClerkUnavailableError()
    await client.get("/v1/me", headers=auth_headers("user_a"))
    with caplog.at_level(logging.INFO):
        response = await client.request(
            "DELETE", "/v1/me", headers=auth_headers("user_a"), json=CODE_BODY
        )
    assert response.status_code == 204
    assert app.state.clerk_users.deleted == ["user_a"]
    assert app.state.apple_sign_in.calls == []
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert errors[0].step == "lookup"
    assert errors[0].exc_info is None
    assert "c1" not in caplog.text


async def test_clerk_delete_failure_never_calls_apple(
    client: httpx2.AsyncClient, app, auth_headers
) -> None:
    app.state.clerk_users.apple_ids = {"user_a": frozenset({"001.abc"})}
    await client.get("/v1/me", headers=auth_headers("user_a"))
    app.state.clerk_users.error = ClerkUnavailableError()
    response = await client.request(
        "DELETE", "/v1/me", headers=auth_headers("user_a"), json=CODE_BODY
    )
    assert response.status_code == 502
    assert app.state.apple_sign_in.calls == []


async def test_no_apple_account_never_calls_apple(
    client: httpx2.AsyncClient, app, auth_headers, caplog
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    with caplog.at_level(logging.INFO, logger="crosstune.users.router"):
        response = await client.request(
            "DELETE", "/v1/me", headers=auth_headers("user_a"), json=CODE_BODY
        )
    assert response.status_code == 204
    assert app.state.apple_sign_in.calls == []
    skipped = [r for r in caplog.records if "no Apple account to revoke" in r.getMessage()]
    assert len(skipped) == 1
    assert skipped[0].levelno == logging.INFO
    assert "c1" not in caplog.text


async def test_a_delete_that_finds_the_row_gone_still_revokes(
    client: httpx2.AsyncClient, app, auth_headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A concurrent delete committed first, so Clerk's copy is gone and the code still revokes."""
    app.state.clerk_users.apple_ids = {"user_a": frozenset({"001.abc"})}
    await client.get("/v1/me", headers=auth_headers("user_a"))

    async def already_purged(*_args: object) -> None:
        return None

    monkeypatch.setattr("crosstune.users.router.purge_account", already_purged)
    response = await client.request(
        "DELETE", "/v1/me", headers=auth_headers("user_a"), json=CODE_BODY
    )
    assert response.status_code == 204
    assert app.state.clerk_users.deleted == []
    assert app.state.apple_sign_in.calls == [("c1", frozenset({"001.abc"}), "app")]


async def test_without_apple_settings_a_code_is_ignored(
    client: httpx2.AsyncClient, app, auth_headers, caplog
) -> None:
    app.state.clerk_users.apple_ids = {"user_a": frozenset({"001.abc"})}
    app.state.apple_sign_in = None
    await client.get("/v1/me", headers=auth_headers("user_a"))
    with caplog.at_level(logging.INFO, logger="crosstune.users.router"):
        response = await client.request(
            "DELETE", "/v1/me", headers=auth_headers("user_a"), json=CODE_BODY
        )
    assert response.status_code == 204
    assert app.state.clerk_users.deleted == ["user_a"]
    assert any("revocation is off" in r.getMessage() for r in caplog.records)
    assert "c1" not in caplog.text


async def test_an_empty_code_is_refused(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.request(
        "DELETE", "/v1/me", headers=auth_headers("user_a"), json={"apple_authorization_code": ""}
    )
    assert response.status_code == 422
    assert app.state.clerk_users.deleted == []
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1


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


async def _grant(
    client: httpx2.AsyncClient,
    auth_headers,
    verify_session: AsyncSession,
    source: str,
    external_id: str,
    expires_at,
) -> None:
    me = (await client.get("/v1/me", headers=auth_headers("user_a"))).json()
    verify_session.add(
        Grant(
            user_id=uuid.UUID(me["id"]),
            kind="premium",
            source=source,
            external_id=external_id,
            expires_at=expires_at,
        )
    )
    await verify_session.commit()


def _sub(
    store_id: str,
    *,
    source: GrantSource = GrantSource.STRIPE,
    environment: GrantEnvironment = GrantEnvironment.PRODUCTION,
    expires_in: timedelta | None = timedelta(days=30),
    auto_renews: bool = True,
) -> PaidSubscription:
    return PaidSubscription(
        subscription_id=f"sub_{store_id}",
        store_id=store_id,
        source=source,
        kind=GrantKind.PREMIUM,
        environment=environment,
        expires_at=None if expires_in is None else utc_now() + expires_in,
        auto_renews=auto_renews,
    )


async def test_delete_cancels_stripe_and_deletes_customer(
    client: httpx2.AsyncClient, app, auth_headers
) -> None:
    events: list[str] = []
    app.state.stripe = FakeStripe(cancelled=events)
    app.state.revenuecat = FakeRevenueCat({"user_a": [_sub("si_123")]}, deleted=events)
    clerk = app.state.clerk_users
    original_delete = clerk.delete_user

    async def recording_delete(clerk_user_id: str) -> None:
        events.append("clerk")
        await original_delete(clerk_user_id)

    clerk.delete_user = recording_delete
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert events == ["si_123", "user_a", "clerk"]


async def test_delete_cancels_what_revenuecat_reports_not_a_stale_grant(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    # A plan change replaced the subscription item, and no webhook has updated the grant since.
    await _grant(client, auth_headers, verify_session, "stripe", "si_before_switch", None)
    app.state.revenuecat = FakeRevenueCat({"user_a": [_sub("si_after_switch")]})
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.cancelled == ["si_after_switch"]


async def test_delete_cancels_nothing_revenuecat_reports_ended(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _grant(client, auth_headers, verify_session, "stripe", "si_123", None)
    ended = _sub("si_123", expires_in=timedelta(minutes=-1), auto_renews=False)
    app.state.revenuecat = FakeRevenueCat({"user_a": [ended]})
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.cancelled == []
    assert app.state.revenuecat.deleted == ["user_a"]


async def test_delete_cancels_a_lapsed_stripe_subscription_still_renewing(
    client: httpx2.AsyncClient, app, auth_headers
) -> None:
    retrying = _sub("si_retrying", expires_in=timedelta(days=-1), auto_renews=True)
    app.state.revenuecat = FakeRevenueCat({"user_a": [retrying]})
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.cancelled == ["si_retrying"]


@pytest.mark.parametrize(("accept", "cancelled"), [(False, []), (True, ["si_sandbox"])])
async def test_delete_cancels_sandbox_stripe_only_where_accepted(
    client: httpx2.AsyncClient,
    app,
    auth_headers,
    accept: bool,  # noqa: FBT001
    cancelled: list[str],
) -> None:
    app.state.settings = app.state.settings.model_copy(
        update={"billing_accept_sandbox_stripe": accept}
    )
    sandbox = _sub("si_sandbox", environment=GrantEnvironment.SANDBOX)
    app.state.revenuecat = FakeRevenueCat({"user_a": [sandbox]})
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.cancelled == cancelled


async def test_delete_apple_subscriber_cancels_nothing(
    client: httpx2.AsyncClient, app, auth_headers
) -> None:
    apple = _sub("2000000123", source=GrantSource.APPLE)
    app.state.revenuecat = FakeRevenueCat({"user_a": [apple]})
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.cancelled == []
    assert app.state.revenuecat.deleted == ["user_a"]


async def test_delete_stripe_failure_keeps_account(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    app.state.stripe = FakeStripe(error=StripeUnavailableError())
    app.state.revenuecat = FakeRevenueCat({"user_a": [_sub("si_123")]})
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 502
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1
    assert await verify_session.scalar(select(func.count()).select_from(DeletedAccount)) == 0
    assert app.state.clerk_users.deleted == []


async def test_delete_revenuecat_failure_keeps_account(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    app.state.revenuecat = FakeRevenueCat(error=RevenueCatUnavailableError())
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 502
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1
    assert app.state.clerk_users.deleted == []
    assert app.state.stripe.cancelled == []


async def test_delete_without_stripe_client_but_live_subscription_is_503(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    app.state.stripe = None
    app.state.revenuecat = FakeRevenueCat({"user_a": [_sub("si_123")]})
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 503
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1
    assert app.state.clerk_users.deleted == []


async def _grants_without_revenuecat(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, *grants: Grant
) -> None:
    app.state.revenuecat = None
    me = (await client.get("/v1/me", headers=auth_headers("user_a"))).json()
    for grant in grants:
        grant.user_id = uuid.UUID(me["id"])
    verify_session.add_all(grants)
    await verify_session.commit()


@pytest.mark.parametrize(
    "grant",
    [
        Grant(kind="premium", source="stripe", external_id="sub_live"),
        Grant(
            kind="premium",
            source="stripe",
            external_id="sub_retrying",
            expires_at=utc_now() - timedelta(days=1),
            auto_renews=True,
        ),
    ],
)
async def test_delete_without_revenuecat_but_live_stripe_grant_is_503(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, grant: Grant
) -> None:
    await _grants_without_revenuecat(client, app, auth_headers, verify_session, grant)
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 503
    assert app.state.stripe.cancelled == []
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1


async def test_delete_without_revenuecat_ignores_ended_stripe_and_apple_grants(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _grants_without_revenuecat(
        client,
        app,
        auth_headers,
        verify_session,
        Grant(
            kind="premium",
            source="stripe",
            external_id="sub_ended",
            expires_at=utc_now() - timedelta(days=1),
        ),
        Grant(kind="premium", source="apple", external_id="sub_apple"),
    )
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.cancelled == []


async def _web_subscription(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, *, age: timedelta
) -> None:
    """A live web subscription started `age` ago, with RevenueCat reporting it."""
    me = (await client.get("/v1/me", headers=auth_headers("user_a"))).json()
    user = await verify_session.get(User, uuid.UUID(me["id"]))
    user.email = EMAIL
    verify_session.add(
        Grant(
            user_id=uuid.UUID(me["id"]),
            kind="premium",
            source="stripe",
            external_id="sub_si_123",
            started_at=utc_now() - age,
            expires_at=utc_now() + timedelta(days=30),
            auto_renews=True,
        )
    )
    await verify_session.commit()
    app.state.revenuecat = FakeRevenueCat({"user_a": [_sub("si_123")]})


async def test_delete_inside_the_window_refunds_then_cancels_and_emails(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds == [("pi_fake", "withdraw:sub_si_123")]
    assert app.state.stripe.calls == ["first_payment_intent", "refund", "cancel"]
    assert app.state.stripe.cancelled == ["si_123"]
    ((message, key),) = app.state.mailer.sent
    assert message.to == EMAIL
    assert key == notice_key("withdrawal", "sub_si_123", None)
    body = " ".join(message.text.split())
    assert "Your Crosstune account and its data were deleted." in body
    assert "catalog" not in body


async def test_delete_after_the_window_only_cancels(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=20))
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds == []
    assert app.state.stripe.cancelled == ["si_123"]
    assert app.state.mailer.sent == []


async def test_delete_after_an_earlier_withdrawal_only_cancels(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    user = await verify_session.scalar(select(User).where(User.clerk_user_id == "user_a"))
    user.withdrew_at = utc_now() - timedelta(days=1)
    await verify_session.commit()
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds == []
    assert app.state.stripe.cancelled == ["si_123"]
    assert app.state.mailer.sent == []


async def test_delete_inside_the_window_leaves_apple_alone(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    me = (await client.get("/v1/me", headers=auth_headers("user_a"))).json()
    verify_session.add(
        Grant(
            user_id=uuid.UUID(me["id"]),
            kind="premium",
            source="apple",
            external_id="sub_2000000123",
            started_at=utc_now() - timedelta(days=2),
            expires_at=utc_now() + timedelta(days=30),
        )
    )
    await verify_session.commit()
    app.state.revenuecat = FakeRevenueCat(
        {"user_a": [_sub("2000000123", source=GrantSource.APPLE)]}
    )
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds == []
    assert app.state.stripe.cancelled == []
    assert app.state.mailer.sent == []


async def test_a_failed_refund_keeps_the_account_and_cancels_nothing(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    app.state.stripe = FakeStripe(error=StripeUnavailableError(), fail_only="refund")
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 502
    assert app.state.stripe.cancelled == []
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1
    assert app.state.mailer.sent == []


async def test_a_failed_cancel_after_the_refund_keeps_the_account_and_a_retry_refunds_once(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    stripe = FakeStripe(error=StripeUnavailableError(), fail_only="cancel")
    app.state.stripe = stripe
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 502
    assert stripe.refunds == [("pi_fake", "withdraw:sub_si_123")]
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1
    verify_session.expire_all()
    grant = await verify_session.scalar(select(Grant).where(Grant.external_id == "sub_si_123"))
    assert grant.refunded_at is not None
    assert grant.store_id == "si_123"
    assert grant.withdrawn_at is None
    assert app.state.mailer.sent == []

    stripe.error = None
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert stripe.refunds == [("pi_fake", "withdraw:sub_si_123")]
    assert stripe.cancelled == ["si_123"]
    assert len(app.state.mailer.sent) == 1


async def test_a_clerk_failure_after_the_refund_keeps_the_withdrawal_and_never_refunds_twice(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    app.state.clerk_users.error = ClerkUnavailableError()
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 502
    verify_session.expire_all()
    user = await verify_session.scalar(select(User).where(User.clerk_user_id == "user_a"))
    assert user.withdrew_at is not None
    grant = await verify_session.scalar(select(Grant).where(Grant.external_id == "sub_si_123"))
    assert grant.refunded_at is not None
    assert grant.withdrawn_at is not None
    assert grant.auto_renews is False
    assert app.state.mailer.sent == []

    app.state.clerk_users.error = None
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds == [("pi_fake", "withdraw:sub_si_123")]
    assert app.state.mailer.sent == []


async def _older_withdrawal(verify_session: AsyncSession, *, account_withdrew: bool) -> None:
    """A withdrawal completed days ago whose email was never recorded."""
    user = await verify_session.scalar(select(User).where(User.clerk_user_id == "user_a"))
    user.email = EMAIL
    if account_withdrew:
        user.withdrew_at = utc_now() - timedelta(days=5)
    verify_session.add(
        Grant(
            user_id=user.id,
            kind="premium",
            source="stripe",
            external_id="sub_si_old",
            started_at=utc_now() - timedelta(days=40),
            expires_at=utc_now() - timedelta(days=5),
            auto_renews=False,
            refunded_at=utc_now() - timedelta(days=5),
            withdrawn_at=utc_now() - timedelta(days=5),
            store_id="si_old",
        )
    )
    await verify_session.commit()


async def test_delete_sends_no_deletion_email_for_an_older_unrecorded_withdrawal(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    await _older_withdrawal(verify_session, account_withdrew=True)
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds == []
    assert app.state.mailer.sent == []


async def test_delete_emails_only_for_the_refund_it_made(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    await _older_withdrawal(verify_session, account_withdrew=False)
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds == [("pi_fake", "withdraw:sub_si_123")]
    assert "account and its data were deleted" in _deletion_email(app)


async def _pending_withdrawal(
    client: httpx2.AsyncClient, verify_session: AsyncSession, auth_headers, store_id: str | None
) -> None:
    """A refunded web subscription whose cancel never went through."""
    me = (await client.get("/v1/me", headers=auth_headers("user_a"))).json()
    user = await verify_session.get(User, uuid.UUID(me["id"]))
    user.email = EMAIL
    verify_session.add(
        Grant(
            user_id=uuid.UUID(me["id"]),
            kind="premium",
            source="stripe",
            external_id="sub_si_123",
            started_at=utc_now() - timedelta(days=3),
            expires_at=utc_now() - timedelta(minutes=5),
            auto_renews=False,
            refunded_at=utc_now() - timedelta(days=1),
            store_id=store_id,
        )
    )
    await verify_session.commit()


async def test_delete_cancels_a_pending_withdrawal_revenuecat_reports_ended(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _pending_withdrawal(client, verify_session, auth_headers, "si_123")
    ended = _sub("si_123", expires_in=timedelta(minutes=-5), auto_renews=False)
    app.state.revenuecat = FakeRevenueCat({"user_a": [ended]})
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds == []
    assert app.state.stripe.cancelled == ["si_123"]
    assert len(app.state.mailer.sent) == 1


async def test_delete_keeps_an_account_whose_pending_withdrawal_has_no_item_to_cancel(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _pending_withdrawal(client, verify_session, auth_headers, None)
    app.state.revenuecat = FakeRevenueCat({"user_a": []})
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 502
    assert app.state.stripe.cancelled == []
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1
    verify_session.expire_all()
    grant = await verify_session.scalar(select(Grant).where(Grant.external_id == "sub_si_123"))
    assert grant.refunded_at is not None
    assert app.state.clerk_users.deleted == []


async def test_delete_without_stripe_but_a_pending_withdrawal_is_503(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _pending_withdrawal(client, verify_session, auth_headers, "si_123")
    app.state.stripe = None
    app.state.revenuecat = FakeRevenueCat({"user_a": []})
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 503
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 1


async def test_a_failed_withdrawal_email_never_fails_the_deletion(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, caplog
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    app.state.mailer.error = MailerUnavailableError()
    with caplog.at_level(logging.WARNING):
        response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 0
    assert any("did not accept a withdrawal email" in r.getMessage() for r in caplog.records)


async def test_a_partial_withdrawal_is_not_refunded_again_but_still_emails(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=20))
    grant = await verify_session.scalar(select(Grant).where(Grant.external_id == "sub_si_123"))
    grant.refunded_at = utc_now() - timedelta(days=6)
    await verify_session.commit()
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert app.state.stripe.refunds == []
    assert app.state.stripe.cancelled == ["si_123"]
    assert len(app.state.mailer.sent) == 1


async def test_the_clerk_webhook_inside_the_window_refunds_and_emails_once(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    body = json.dumps({"type": "user.deleted", "data": {"id": "user_a"}}).encode()
    response = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))
    assert response.status_code == 204
    assert app.state.stripe.refunds == [("pi_fake", "withdraw:sub_si_123")]
    assert app.state.stripe.calls == ["first_payment_intent", "refund", "cancel"]
    assert len(app.state.mailer.sent) == 1

    again = await client.post("/v1/webhooks/clerk", content=body, headers=sign(body))
    assert again.status_code == 204
    assert len(app.state.stripe.refunds) == 1
    assert len(app.state.mailer.sent) == 1


class _Gap:
    """Holds a deletion between its refund commit and the lock it then takes again."""

    def __init__(self) -> None:
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.calls = 0


def _pause_after_the_refund_commit(monkeypatch) -> _Gap:
    gap = _Gap()
    relock = closing.lock_user

    async def paused(session: AsyncSession, user_id: uuid.UUID) -> None:
        gap.calls += 1
        if gap.calls == 1:
            gap.entered.set()
            await gap.release.wait()
        await relock(session, user_id)

    monkeypatch.setattr(closing, "lock_user", paused)
    return gap


async def _until_waiting_or_done(engine, task: asyncio.Task) -> None:
    """Return once some request waits on an advisory lock, or `task` has finished."""
    query = text("select count(*) from pg_locks where locktype = 'advisory' and not granted")
    while not task.done():
        async with engine.connect() as conn:
            if await conn.scalar(query):
                return
        await asyncio.sleep(0.01)


def _deletion_email(app) -> str:
    ((message, key),) = app.state.mailer.sent
    assert key == notice_key("withdrawal", "sub_si_123", None)
    return " ".join(message.text.split())


async def test_a_second_delete_waits_for_the_first_to_finish_its_billing(
    engine, client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, monkeypatch
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    gap = _pause_after_the_refund_commit(monkeypatch)
    first = asyncio.create_task(client.delete("/v1/me", headers=auth_headers("user_a")))
    await gap.entered.wait()
    second = asyncio.create_task(client.delete("/v1/me", headers=auth_headers("user_a")))
    await _until_waiting_or_done(engine, second)
    gap.release.set()

    responses = await asyncio.gather(first, second)

    assert [r.status_code for r in responses] == [204, 204]
    assert app.state.stripe.refunds == [("pi_fake", "withdraw:sub_si_123")]
    assert app.state.clerk_users.deleted == ["user_a"]
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 0
    assert "account and its data were deleted" in _deletion_email(app)


async def test_the_withdrawal_pass_leaves_an_account_a_deletion_is_refunding(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, monkeypatch
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    gap = _pause_after_the_refund_commit(monkeypatch)
    deletion = asyncio.create_task(client.delete("/v1/me", headers=auth_headers("user_a")))
    await gap.entered.wait()

    state = app.state
    completed = await complete_pending_withdrawals(
        state.sessionmaker, state.stripe, state.revenuecat, state.mailer, state.settings, utc_now()
    )
    assert completed == 0
    assert state.stripe.cancelled == []
    gap.release.set()

    assert (await deletion).status_code == 204
    assert state.stripe.cancelled == ["si_123"]
    assert "catalog" not in _deletion_email(app)


async def test_a_withdrawal_waits_for_a_deletion_that_is_refunding(
    engine, client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, monkeypatch
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    gap = _pause_after_the_refund_commit(monkeypatch)
    deletion = asyncio.create_task(client.delete("/v1/me", headers=auth_headers("user_a")))
    await gap.entered.wait()
    withdrawal = asyncio.create_task(
        client.post("/v1/me/billing/withdraw", headers=auth_headers("user_a"))
    )
    await _until_waiting_or_done(engine, withdrawal)
    gap.release.set()

    deleted, withdrew = await asyncio.gather(deletion, withdrawal)

    assert deleted.status_code == 204
    assert withdrew.status_code == 409
    assert app.state.stripe.refunds == [("pi_fake", "withdraw:sub_si_123")]
    assert app.state.stripe.cancelled == ["si_123"]
    assert "catalog" not in _deletion_email(app)


async def test_a_deletion_that_finds_the_account_gone_after_its_refund_stops_cleanly(
    client: httpx2.AsyncClient, app, auth_headers, verify_session: AsyncSession, monkeypatch
) -> None:
    await _web_subscription(client, app, auth_headers, verify_session, age=timedelta(days=10))
    gap = _pause_after_the_refund_commit(monkeypatch)
    deletion = asyncio.create_task(client.delete("/v1/me", headers=auth_headers("user_a")))
    await gap.entered.wait()
    # Another writer removes the account while the deletion sits between its steps.
    await verify_session.execute(text("delete from users where clerk_user_id = 'user_a'"))
    await verify_session.commit()
    gap.release.set()

    response = await deletion

    assert response.status_code == 204
    assert app.state.stripe.refunds == [("pi_fake", "withdraw:sub_si_123")]
    assert app.state.clerk_users.deleted == []
