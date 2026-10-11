"""Refreshing paid access from RevenueCat, on demand and from its webhook."""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from pydantic import SecretStr
from sqlalchemy import delete, func, select

from crosstune.billing import purchases
from crosstune.billing.grants import PaidSubscription
from crosstune.billing.revenuecat import RevenueCatUnavailableError
from crosstune.db.base import utc_now
from crosstune.models import Grant, User
from crosstune.ratelimit import RateLimiter
from crosstune.users.service import get_or_create_user
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantSource
from tests.fakes import FakeRevenueCat
from tests.helpers import pull

if TYPE_CHECKING:
    import httpx2
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

SECRET = "rc-webhook-secret"  # gitleaks:allow -- fixture, not a credential
WEBHOOK = "/v1/webhooks/revenuecat"
REFRESH = "/v1/me/billing/refresh"


def _stripe_sub(
    store_id: str = "si_1",
    *,
    source: GrantSource = GrantSource.STRIPE,
    environment: GrantEnvironment = GrantEnvironment.PRODUCTION,
) -> PaidSubscription:
    return PaidSubscription(
        store_id=store_id,
        source=source,
        kind=GrantKind.PREMIUM,
        environment=environment,
        expires_at=utc_now() + timedelta(days=30),
        auto_renews=True,
    )


def _event(**fields) -> dict:
    return {"api_version": "1.0", "event": {"type": "INITIAL_PURCHASE", **fields}}


def _auth(secret: str = SECRET) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


@pytest.fixture
def webhook_app(app: FastAPI, settings: Settings) -> FastAPI:
    app.state.settings = settings.model_copy(update={"revenuecat_webhook_auth": SecretStr(SECRET)})
    return app


def _entitlement(body: dict) -> dict:
    (row,) = [r["row"] for r in body["rows"] if r["table"] == "entitlements"]
    return row


async def _sign_up(client: httpx2.AsyncClient, auth_headers, *names: str) -> None:
    for name in names:
        assert (await client.get("/v1/me", headers=auth_headers(name))).status_code == 200


async def test_refresh_mirrors_and_turns_premium(client, app, auth_headers) -> None:
    app.state.revenuecat = FakeRevenueCat({"user_a": [_stripe_sub()]})
    headers = auth_headers("user_a")

    response = await client.post(REFRESH, headers=headers)

    assert response.status_code == 204
    row = _entitlement(await pull(client, headers))
    assert row["premium_source"] == "stripe"
    assert row["auto_renews"] is True


async def test_refresh_moving_a_subscription_refreshes_its_old_account(
    client, app, auth_headers
) -> None:
    app.state.revenuecat = FakeRevenueCat({"user_a": [_stripe_sub()]})
    await client.post(REFRESH, headers=auth_headers("user_a"))
    app.state.revenuecat = FakeRevenueCat({"user_b": [_stripe_sub()]})

    assert (await client.post(REFRESH, headers=auth_headers("user_b"))).status_code == 204

    assert _entitlement(await pull(client, auth_headers("user_b")))["premium_source"] == "stripe"
    assert _entitlement(await pull(client, auth_headers("user_a")))["premium_source"] != "stripe"


async def test_refresh_twice_bumps_nothing(client, app, auth_headers) -> None:
    app.state.revenuecat = FakeRevenueCat({"user_a": [_stripe_sub()]})
    headers = auth_headers("user_a")
    await client.post(REFRESH, headers=headers)
    first = _entitlement(await pull(client, headers))

    assert (await client.post(REFRESH, headers=headers)).status_code == 204

    assert _entitlement(await pull(client, headers))["server_seq"] == first["server_seq"]


async def test_refresh_unconfigured_is_503(client, app, auth_headers) -> None:
    app.state.revenuecat = None

    response = await client.post(REFRESH, headers=auth_headers("user_a"))

    assert response.status_code == 503
    assert response.json()["type"] == "urn:crosstune:billing-unavailable"


async def test_refresh_revenuecat_down_is_502(client, app, auth_headers) -> None:
    app.state.revenuecat = FakeRevenueCat(error=RevenueCatUnavailableError("down"))

    response = await client.post(REFRESH, headers=auth_headers("user_a"))

    assert response.status_code == 502
    assert response.json()["type"] == "urn:crosstune:billing-failed"


async def test_refresh_refuses_past_the_limit(client, app, auth_headers) -> None:
    app.state.billing_refresh_limiter = RateLimiter(limit=1, window_seconds=60.0)
    fake = FakeRevenueCat({"user_a": [_stripe_sub()]})
    calls: list[str] = []
    original = fake.subscriptions

    async def spy(customer_id: str, *, now=None) -> list[PaidSubscription]:
        calls.append(customer_id)
        return await original(customer_id, now=now)

    fake.subscriptions = spy
    app.state.revenuecat = fake

    first = await client.post(REFRESH, headers=auth_headers("user_a"))
    second = await client.post(REFRESH, headers=auth_headers("user_a"))
    other = await client.post(REFRESH, headers=auth_headers("user_b"))

    assert first.status_code == 204
    assert second.status_code == 429
    assert second.headers["content-type"] == "application/problem+json"
    assert 0 < int(second.headers["retry-after"]) <= 60
    assert other.status_code == 204
    # The refused call asked RevenueCat nothing.
    assert calls == ["user_a", "user_b"]


async def test_refresh_limit_comes_from_settings(app, settings) -> None:
    limiter = app.state.billing_refresh_limiter

    hits = [limiter.hit("user") for _ in range(settings.billing_refreshes_per_minute + 1)]

    assert hits[:-1] == [None] * settings.billing_refreshes_per_minute
    assert hits[-1] is not None


async def test_refresh_requires_sign_in(client) -> None:
    assert (await client.post(REFRESH)).status_code == 401


async def test_webhook_rejects_wrong_authorization(client, webhook_app) -> None:
    for headers in ({}, _auth("wrong"), {"Authorization": SECRET}):
        response = await client.post(WEBHOOK, json=_event(app_user_id="user_a"), headers=headers)
        assert response.status_code == 401


async def test_webhook_with_no_secret_configured_is_401(client, app, settings) -> None:
    app.state.settings = settings.model_copy(update={"revenuecat_webhook_auth": SecretStr("")})

    response = await client.post(WEBHOOK, json=_event(app_user_id="user_a"), headers=_auth(""))

    assert response.status_code == 401


async def test_webhook_accepts_the_secret(client, webhook_app) -> None:
    response = await client.post(WEBHOOK, json=_event(app_user_id="user_a"), headers=_auth())

    assert response.status_code == 200


async def test_webhook_refreshes_each_known_id(client, webhook_app, auth_headers) -> None:
    await _sign_up(client, auth_headers, "user_a", "user_b", "user_c", "user_d")
    fake = FakeRevenueCat(
        {name: [_stripe_sub(f"si_{name}")] for name in ("user_a", "user_b", "user_c", "user_d")}
    )
    calls: list[str] = []
    original = fake.subscriptions

    async def spy(customer_id: str, *, now=None) -> list[PaidSubscription]:
        calls.append(customer_id)
        return await original(customer_id, now=now)

    fake.subscriptions = spy
    webhook_app.state.revenuecat = fake
    event = _event(
        app_user_id="user_a",
        original_app_user_id="user_a",
        aliases=["user_a", "user_b", "$RCAnonymousID:abc"],
        transferred_from=["user_c", 7, None],
        transferred_to=["user_d"],
    )

    response = await client.post(WEBHOOK, json=event, headers=_auth())

    assert response.status_code == 200
    assert sorted(calls) == ["user_a", "user_b", "user_c", "user_d"]
    for name in ("user_a", "user_b", "user_c", "user_d"):
        row = _entitlement(await pull(client, auth_headers(name)))
        assert row["premium_source"] == "stripe"


async def test_webhook_unknown_user_is_200_and_writes_nothing(
    client, webhook_app, verify_session
) -> None:
    webhook_app.state.revenuecat = FakeRevenueCat({"ghost": [_stripe_sub()]})

    response = await client.post(
        WEBHOOK,
        json=_event(app_user_id="$RCAnonymousID:abc", aliases=["ghost"]),
        headers=_auth(),
    )

    assert response.status_code == 200
    assert await verify_session.scalar(select(func.count()).select_from(Grant)) == 0


async def test_webhook_test_event_is_200(client, webhook_app) -> None:
    event = {"api_version": "1.0", "event": {"type": "TEST", "app_user_id": "user_a"}}

    assert (await client.post(WEBHOOK, json=event, headers=_auth())).status_code == 200


async def test_webhook_revenuecat_down_is_503(client, webhook_app, auth_headers) -> None:
    await _sign_up(client, auth_headers, "user_a")
    webhook_app.state.revenuecat = FakeRevenueCat(error=RevenueCatUnavailableError("down"))

    response = await client.post(WEBHOOK, json=_event(app_user_id="user_a"), headers=_auth())

    assert response.status_code == 503


async def test_webhook_unconfigured_is_503(client, webhook_app) -> None:
    webhook_app.state.revenuecat = None

    response = await client.post(WEBHOOK, json=_event(app_user_id="user_a"), headers=_auth())

    assert response.status_code == 503


@pytest.mark.parametrize("body", [b"not json", b"[1, 2]", b'{"event": "x"}'])
async def test_webhook_bad_body_is_200(client, webhook_app, body) -> None:
    response = await client.post(WEBHOOK, content=body, headers=_auth())

    assert response.status_code == 200


async def test_webhook_reads_every_user_before_locking_any(
    client, webhook_app, auth_headers, monkeypatch
) -> None:
    await _sign_up(client, auth_headers, "user_a", "user_b")
    events: list[str] = []
    fake = FakeRevenueCat()
    original = fake.subscriptions

    async def spy_subscriptions(customer_id: str, *, now=None) -> list[PaidSubscription]:
        events.append("fetch")
        return await original(customer_id, now=now)

    real_lock = purchases.lock_user

    async def spy_lock(session, user_id) -> None:
        events.append("lock")
        await real_lock(session, user_id)

    fake.subscriptions = spy_subscriptions
    webhook_app.state.revenuecat = fake
    monkeypatch.setattr(purchases, "lock_user", spy_lock)

    response = await client.post(
        WEBHOOK, json=_event(app_user_id="user_a", aliases=["user_b"]), headers=_auth()
    )

    assert response.status_code == 200
    assert events == ["fetch", "fetch", "lock", "lock"]


async def test_webhook_refreshes_only_the_known_user(client, webhook_app, auth_headers) -> None:
    await _sign_up(client, auth_headers, "user_a")
    fake = FakeRevenueCat({"user_a": [_stripe_sub()], "ghost": [_stripe_sub("si_ghost")]})
    calls: list[str] = []
    original = fake.subscriptions

    async def spy(customer_id: str, *, now=None) -> list[PaidSubscription]:
        calls.append(customer_id)
        return await original(customer_id, now=now)

    fake.subscriptions = spy
    webhook_app.state.revenuecat = fake

    response = await client.post(
        WEBHOOK, json=_event(app_user_id="ghost", aliases=["user_a"]), headers=_auth()
    )

    assert response.status_code == 200
    assert calls == ["user_a"]
    assert _entitlement(await pull(client, auth_headers("user_a")))["premium_source"] == "stripe"


async def test_refresh_many_locks_users_in_ascending_id_order(
    session: AsyncSession, settings: Settings, monkeypatch
) -> None:
    users = [
        await get_or_create_user(session, f"user_{name}", f"{name}@example.com", settings)
        for name in "abc"
    ]
    locked: list = []
    real_lock = purchases.lock_user

    async def spy_lock(session, user_id) -> None:
        locked.append(user_id)
        await real_lock(session, user_id)

    monkeypatch.setattr(purchases, "lock_user", spy_lock)

    await purchases.refresh_many_purchases(
        session,
        sorted(users, key=lambda user: user.id, reverse=True),
        FakeRevenueCat(),
        settings,
        utc_now(),
    )

    assert locked == sorted(user.id for user in users)


async def test_refresh_skips_a_user_deleted_before_the_lock(
    session: AsyncSession, settings: Settings
) -> None:
    user = await get_or_create_user(session, "user_gone", "gone@example.com", settings)
    await session.execute(delete(User).where(User.id == user.id))
    revenuecat = FakeRevenueCat({"user_gone": [_stripe_sub()]})

    await purchases.refresh_purchases(session, user, revenuecat, settings, utc_now())

    assert await session.scalar(select(func.count()).select_from(Grant)) == 0


def _sandbox_stripe() -> PaidSubscription:
    return _stripe_sub("si_sandbox", environment=GrantEnvironment.SANDBOX)


def _accept_sandbox_stripe(app: FastAPI, *, accept: bool) -> None:
    app.state.settings = app.state.settings.model_copy(
        update={"billing_accept_sandbox_stripe": accept}
    )


async def _active_grants(verify_session: AsyncSession) -> list[tuple[str, str]]:
    now = utc_now()
    rows = await verify_session.execute(
        select(Grant.source, Grant.environment).where(
            Grant.source.in_(["apple", "stripe"]),
            (Grant.expires_at.is_(None)) | (Grant.expires_at > now),
        )
    )
    return [tuple(row) for row in rows.all()]


async def test_accepting_sandbox_stripe_is_off_by_default(settings: Settings) -> None:
    assert settings.billing_accept_sandbox_stripe is False


async def test_refresh_drops_sandbox_stripe(client, app, auth_headers, verify_session) -> None:
    app.state.revenuecat = FakeRevenueCat({"user_a": [_sandbox_stripe()]})
    headers = auth_headers("user_a")

    assert (await client.post(REFRESH, headers=headers)).status_code == 204

    assert _entitlement(await pull(client, headers))["premium_source"] != "stripe"
    assert await _active_grants(verify_session) == []


async def test_webhook_drops_sandbox_stripe(
    client, webhook_app, auth_headers, verify_session
) -> None:
    await _sign_up(client, auth_headers, "user_a")
    webhook_app.state.revenuecat = FakeRevenueCat({"user_a": [_sandbox_stripe()]})

    response = await client.post(WEBHOOK, json=_event(app_user_id="user_a"), headers=_auth())

    assert response.status_code == 200
    assert _entitlement(await pull(client, auth_headers("user_a")))["premium_source"] != "stripe"
    assert await _active_grants(verify_session) == []


async def test_refresh_keeps_sandbox_stripe_where_accepted(client, app, auth_headers) -> None:
    _accept_sandbox_stripe(app, accept=True)
    app.state.revenuecat = FakeRevenueCat({"user_a": [_sandbox_stripe()]})
    headers = auth_headers("user_a")

    assert (await client.post(REFRESH, headers=headers)).status_code == 204

    assert _entitlement(await pull(client, headers))["premium_source"] == "stripe"


async def test_webhook_keeps_sandbox_stripe_where_accepted(
    client, webhook_app, auth_headers
) -> None:
    _accept_sandbox_stripe(webhook_app, accept=True)
    await _sign_up(client, auth_headers, "user_a")
    webhook_app.state.revenuecat = FakeRevenueCat({"user_a": [_sandbox_stripe()]})

    response = await client.post(WEBHOOK, json=_event(app_user_id="user_a"), headers=_auth())

    assert response.status_code == 200
    assert _entitlement(await pull(client, auth_headers("user_a")))["premium_source"] == "stripe"


async def test_sandbox_apple_counts_without_accepting_sandbox_stripe(
    client, app, auth_headers
) -> None:
    sandbox_apple = _stripe_sub(
        "2000000123", source=GrantSource.APPLE, environment=GrantEnvironment.SANDBOX
    )
    app.state.revenuecat = FakeRevenueCat({"user_a": [sandbox_apple]})
    headers = auth_headers("user_a")

    assert (await client.post(REFRESH, headers=headers)).status_code == 204

    assert _entitlement(await pull(client, headers))["premium_source"] == "apple"


async def test_production_stripe_counts_without_accepting_sandbox_stripe(
    client, app, auth_headers
) -> None:
    app.state.revenuecat = FakeRevenueCat({"user_a": [_stripe_sub(), _sandbox_stripe()]})
    headers = auth_headers("user_a")

    assert (await client.post(REFRESH, headers=headers)).status_code == 204

    assert _entitlement(await pull(client, headers))["premium_source"] == "stripe"


async def test_a_dropped_sandbox_stripe_subscription_ends_its_grant(
    client, app, auth_headers, verify_session
) -> None:
    _accept_sandbox_stripe(app, accept=True)
    app.state.revenuecat = FakeRevenueCat({"user_a": [_sandbox_stripe()]})
    headers = auth_headers("user_a")
    await client.post(REFRESH, headers=headers)
    assert await _active_grants(verify_session) == [("stripe", "sandbox")]

    _accept_sandbox_stripe(app, accept=False)
    assert (await client.post(REFRESH, headers=headers)).status_code == 204

    assert await _active_grants(verify_session) == []
    assert _entitlement(await pull(client, headers))["premium_source"] != "stripe"
