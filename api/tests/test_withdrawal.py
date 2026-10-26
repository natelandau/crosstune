"""POST /v1/me/billing/withdraw: a web subscriber's one full refund within 14 days."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.billing.emails import notice_key
from crosstune.billing.grants import PaidSubscription
from crosstune.billing.revenuecat import RevenueCatUnavailableError
from crosstune.billing.stripe import StripeUnavailableError
from crosstune.billing.withdrawal import complete_pending_withdrawals, withdraw
from crosstune.db.base import utc_now
from crosstune.db.locks import lock_user
from crosstune.email.resend import MailerUnavailableError
from crosstune.models import Entitlement, Grant, User
from crosstune.ratelimit import RateLimiter
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantPeriod, GrantSource
from tests.fakes import FakeRevenueCat, FakeStripe
from tests.helpers import pull

if TYPE_CHECKING:
    from datetime import datetime

    import httpx2
    from fastapi import FastAPI

    from crosstune.email.resend import EmailMessage

pytestmark = pytest.mark.anyio

WITHDRAW = "/v1/me/billing/withdraw"
REFRESH = "/v1/me/billing/refresh"
WEBHOOK = "/v1/webhooks/revenuecat"
SECRET = "rc-webhook-secret"  # gitleaks:allow -- fixture, not a credential
USER = "user_w"
EMAIL = "w@example.com"


def _sub(
    *,
    started: timedelta = timedelta(days=3),
    source: GrantSource = GrantSource.STRIPE,
    subscription_id: str = "sub_1",
) -> PaidSubscription:
    now = utc_now()
    return PaidSubscription(
        subscription_id=subscription_id,
        store_id=f"si_{subscription_id}",
        source=source,
        kind=GrantKind.PREMIUM,
        environment=GrantEnvironment.PRODUCTION,
        expires_at=now - started + timedelta(days=30),
        auto_renews=True,
        started_at=now - started,
        period=GrantPeriod.MONTH,
    )


def _headers(make_token, email: str | None = EMAIL) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(USER, email=email)}"}


async def _subscribe(
    client: httpx2.AsyncClient, app: FastAPI, headers: dict[str, str], sub: PaidSubscription
) -> None:
    app.state.revenuecat = FakeRevenueCat({USER: [sub]})
    assert (await client.post(REFRESH, headers=headers)).status_code == 204


def _entitlement(body: dict) -> dict:
    (row,) = [r["row"] for r in body["rows"] if r["table"] == "entitlements"]
    return row


async def _grant(verify_session: AsyncSession) -> Grant:
    verify_session.expunge_all()
    return (
        await verify_session.scalars(select(Grant).where(Grant.source == GrantSource.STRIPE.value))
    ).one()


def _withdrawal_mail(app: FastAPI) -> list[tuple[EmailMessage, str]]:
    """The withdrawal emails sent, leaving out the purchase confirmation a refresh sends."""
    return [(m, key) for m, key in app.state.mailer.sent if key.startswith("billing/withdrawal/")]


async def _withdrew_at(verify_session: AsyncSession) -> datetime | None:
    return await verify_session.scalar(select(User.withdrew_at).where(User.clerk_user_id == USER))


async def test_withdraw_refunds_cancels_and_ends_premium(
    client, app, make_token, verify_session
) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    before = _entitlement(await pull(client, headers))
    assert before["withdraw_until"] is not None
    assert before["withdrawal_used"] is False

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 204
    stripe: FakeStripe = app.state.stripe
    assert stripe.refunds == [("pi_fake", "withdraw:sub_1")]
    assert stripe.cancelled == ["si_sub_1"]
    grant = await _grant(verify_session)
    assert grant.withdrawn_at is not None
    assert grant.expires_at == grant.withdrawn_at
    assert grant.auto_renews is False
    assert await _withdrew_at(verify_session) == grant.withdrawn_at
    row = _entitlement(await pull(client, headers))
    assert row["withdraw_until"] is None
    assert row["withdrawal_used"] is True
    assert row["premium_source"] != "stripe"
    ((message, key),) = _withdrawal_mail(app)
    assert message.to == EMAIL
    assert key == notice_key("withdrawal", "sub_1", None)


async def test_withdraw_on_day_15_is_refused_as_window_closed(
    client, app, make_token, verify_session
) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub(started=timedelta(days=15)))

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 409
    body = response.json()
    assert body["type"] == "urn:crosstune:withdrawal-refused"
    assert body["reason"] == "window_closed"
    assert app.state.stripe.refunds == []
    assert (await _grant(verify_session)).withdrawn_at is None


async def test_a_second_withdrawal_is_refused_and_refunds_nothing(client, app, make_token) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    assert (await client.post(WITHDRAW, headers=headers)).status_code == 204

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 409
    assert response.json()["reason"] == "already_withdrawn"
    assert len(app.state.stripe.refunds) == 1
    assert len(_withdrawal_mail(app)) == 1


async def test_a_new_subscription_after_a_withdrawal_is_still_refused(
    client, app, make_token
) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    assert (await client.post(WITHDRAW, headers=headers)).status_code == 204
    await _subscribe(client, app, headers, _sub(subscription_id="sub_2"))

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 409
    assert response.json()["reason"] == "already_withdrawn"
    assert len(app.state.stripe.refunds) == 1


async def test_an_apple_subscription_is_refused_as_no_web_subscription(
    client, app, make_token
) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub(source=GrantSource.APPLE))

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 409
    assert response.json()["reason"] == "no_web_subscription"
    assert app.state.stripe.refunds == []


async def test_no_subscription_is_refused_as_no_web_subscription(client, app, make_token) -> None:
    response = await client.post(WITHDRAW, headers=_headers(make_token))

    assert response.status_code == 409
    assert response.json()["reason"] == "no_web_subscription"


async def test_a_stripe_failure_on_refund_is_503_and_leaves_the_grant_live(
    client, app, make_token, verify_session
) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    app.state.stripe = FakeStripe(error=StripeUnavailableError("down"))

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 503
    assert response.json()["type"] == "urn:crosstune:billing-unavailable"
    grant = await _grant(verify_session)
    assert grant.withdrawn_at is None
    assert grant.auto_renews is True
    assert await _withdrew_at(verify_session) is None
    assert _entitlement(await pull(client, headers))["withdraw_until"] is not None
    assert _withdrawal_mail(app) == []


async def _stuck_after_refund(
    client: httpx2.AsyncClient, app: FastAPI, headers: dict[str, str], monkeypatch
) -> None:
    """Withdraw with a cancel that fails, leaving the refund recorded and the grant pending."""
    await _subscribe(client, app, headers, _sub())

    async def failing_cancel(store_id: str) -> None:
        raise StripeUnavailableError(store_id)

    with monkeypatch.context() as patch:
        patch.setattr(app.state.stripe, "cancel", failing_cancel)
        assert (await client.post(WITHDRAW, headers=headers)).status_code == 503


async def test_a_failed_cancel_records_the_refund_and_logs_an_error_without_the_email(
    client, app, make_token, verify_session, monkeypatch, caplog
) -> None:
    headers = _headers(make_token)

    with caplog.at_level(logging.ERROR, logger="crosstune.billing.withdrawal"):
        await _stuck_after_refund(client, app, headers, monkeypatch)

    grant = await _grant(verify_session)
    assert grant.refunded_at is not None
    assert grant.withdrawn_at is None
    assert grant.store_id == "si_sub_1"
    assert await _withdrew_at(verify_session) is None
    assert _withdrawal_mail(app) == []
    (record,) = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert record.subscription == "sub_1"
    assert record.store_id == "si_sub_1"
    assert EMAIL not in repr(record.__dict__)


async def test_a_retry_after_a_failed_cancel_completes_without_a_second_refund(
    client, app, make_token, verify_session, monkeypatch
) -> None:
    headers = _headers(make_token)
    await _stuck_after_refund(client, app, headers, monkeypatch)

    assert (await client.post(WITHDRAW, headers=headers)).status_code == 204

    stripe: FakeStripe = app.state.stripe
    assert stripe.refunds == [("pi_fake", "withdraw:sub_1")]
    assert stripe.cancelled == ["si_sub_1"]
    assert (await _grant(verify_session)).withdrawn_at is not None
    assert await _withdrew_at(verify_session) is not None
    assert len(_withdrawal_mail(app)) == 1


async def test_a_retry_completes_after_a_refresh_ended_the_refunded_grant(
    client, app, make_token, verify_session, monkeypatch
) -> None:
    headers = _headers(make_token)
    await _stuck_after_refund(client, app, headers, monkeypatch)
    # RevenueCat saw the refund and dropped the subscription, so the sync ends the grant.
    app.state.revenuecat = FakeRevenueCat({USER: []})
    assert (await client.post(REFRESH, headers=headers)).status_code == 204

    assert (await client.post(WITHDRAW, headers=headers)).status_code == 204

    stripe: FakeStripe = app.state.stripe
    assert len(stripe.refunds) == 1
    assert stripe.cancelled == ["si_sub_1"]
    grant = await _grant(verify_session)
    assert grant.withdrawn_at is not None
    assert grant.auto_renews is False
    assert await _withdrew_at(verify_session) is not None


async def _complete(app: FastAPI) -> int:
    state = app.state
    return await complete_pending_withdrawals(
        state.sessionmaker, state.stripe, state.revenuecat, state.mailer, state.settings, utc_now()
    )


async def test_the_pass_completes_a_stuck_withdrawal_once(
    client, app, make_token, verify_session, monkeypatch
) -> None:
    headers = _headers(make_token)
    await _stuck_after_refund(client, app, headers, monkeypatch)

    assert await _complete(app) == 1
    assert await _complete(app) == 0

    stripe: FakeStripe = app.state.stripe
    assert len(stripe.refunds) == 1
    assert stripe.cancelled == ["si_sub_1"]
    assert (await _grant(verify_session)).withdrawn_at is not None
    assert len(_withdrawal_mail(app)) == 1
    assert _entitlement(await pull(client, headers))["premium_source"] != "stripe"


async def test_the_pass_leaves_a_still_failing_cancel_stuck_and_logs_an_error(
    client, app, make_token, verify_session, monkeypatch, caplog
) -> None:
    headers = _headers(make_token)
    await _stuck_after_refund(client, app, headers, monkeypatch)
    app.state.stripe = FakeStripe(error=StripeUnavailableError("down"))

    with caplog.at_level(logging.ERROR, logger="crosstune.billing.withdrawal"):
        assert await _complete(app) == 0

    grant = await _grant(verify_session)
    assert grant.refunded_at is not None
    assert grant.withdrawn_at is None
    assert any(r.levelno == logging.ERROR for r in caplog.records)
    assert _withdrawal_mail(app) == []


async def _pending_grant(
    verify_session: AsyncSession, clerk_user_id: str, subscription_id: str, store_id: str | None
) -> None:
    """A refunded web grant whose cancel never went through, for its own account."""
    user = User(clerk_user_id=clerk_user_id)
    verify_session.add(user)
    await verify_session.flush()
    verify_session.add(
        Grant(
            user_id=user.id,
            kind=GrantKind.PREMIUM.value,
            source=GrantSource.STRIPE.value,
            external_id=subscription_id,
            started_at=utc_now() - timedelta(days=3),
            expires_at=utc_now() + timedelta(days=27),
            auto_renews=True,
            refunded_at=utc_now() - timedelta(hours=1),
            store_id=store_id,
        )
    )
    await verify_session.commit()


async def test_one_grant_failing_unexpectedly_leaves_the_pass_to_finish_the_rest(
    app, verify_session, monkeypatch, caplog
) -> None:
    await _pending_grant(verify_session, "user_bad", "sub_bad", "si_bad")
    await _pending_grant(verify_session, "user_good", "sub_good", "si_good")
    app.state.revenuecat = FakeRevenueCat({})
    stripe: FakeStripe = app.state.stripe
    cancel = stripe.cancel

    async def cancel_or_break(store_id: str) -> None:
        if store_id == "si_bad":
            msg = "unexpected"
            raise RuntimeError(msg)
        await cancel(store_id)

    monkeypatch.setattr(stripe, "cancel", cancel_or_break)

    with caplog.at_level(logging.ERROR, logger="crosstune.billing.withdrawal"):
        assert await _complete(app) == 1

    assert stripe.cancelled == ["si_good"]
    verify_session.expunge_all()
    ended = dict(
        (await verify_session.execute(select(Grant.external_id, Grant.withdrawn_at))).tuples().all()
    )
    assert ended["sub_bad"] is None
    assert ended["sub_good"] is not None
    (record,) = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert record.getMessage() == "could not complete a pending withdrawal"


async def test_the_pass_leaves_a_grant_with_no_item_to_cancel_pending(
    app, verify_session, caplog
) -> None:
    await _pending_grant(verify_session, "user_lost", "sub_lost", None)
    app.state.revenuecat = FakeRevenueCat({})

    with caplog.at_level(logging.ERROR, logger="crosstune.billing.withdrawal"):
        assert await _complete(app) == 0

    assert app.state.stripe.cancelled == []
    assert any("no Stripe item to cancel" in r.getMessage() for r in caplog.records)
    verify_session.expunge_all()
    grant = await verify_session.scalar(select(Grant).where(Grant.external_id == "sub_lost"))
    assert grant.withdrawn_at is None


async def test_revenuecat_down_is_503_and_refunds_nothing(client, app, make_token) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    app.state.revenuecat = FakeRevenueCat(error=RevenueCatUnavailableError("down"))

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 503
    assert app.state.stripe.refunds == []


async def test_a_grant_revenuecat_no_longer_lists_is_503(client, app, make_token) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    app.state.revenuecat = FakeRevenueCat({USER: []})

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 503
    assert app.state.stripe.refunds == []


@pytest.mark.parametrize("missing", ["stripe", "revenuecat"])
async def test_unconfigured_billing_is_503(client, app, make_token, missing: str) -> None:
    setattr(app.state, missing, None)

    response = await client.post(WITHDRAW, headers=_headers(make_token))

    assert response.status_code == 503
    assert response.json()["type"] == "urn:crosstune:billing-unavailable"


async def test_withdraw_refuses_past_the_limit(client, app, make_token) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub(started=timedelta(days=15)))
    app.state.billing_refresh_limiter = RateLimiter(limit=1, window_seconds=60.0)
    assert (await client.post(WITHDRAW, headers=headers)).status_code == 409

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 429
    assert "Retry-After" in response.headers


async def test_concurrent_withdrawals_refund_once(
    engine, client, app, make_token, verify_session
) -> None:
    """Both calls queue on lock_user, which is held through the refund's commit."""
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    user_id = await verify_session.scalar(select(User.id).where(User.clerk_user_id == USER))
    assert isinstance(user_id, uuid.UUID)

    async with engine.connect() as lock_conn:
        lock_trans = await lock_conn.begin()
        lock_session = AsyncSession(
            bind=lock_conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            await lock_user(lock_session, user_id)
            first = asyncio.create_task(client.post(WITHDRAW, headers=headers))
            second = asyncio.create_task(client.post(WITHDRAW, headers=headers))
            await asyncio.sleep(0.1)
            assert not first.done()
            assert not second.done()

            # Releasing this transaction frees the advisory lock for both withdrawals.
            await lock_trans.commit()
            responses = await asyncio.wait_for(asyncio.gather(first, second), timeout=5)
        finally:
            await lock_session.close()

    # The call that loses the lock either finishes the pending refund itself or, once the
    # other has finished, is refused; either way Stripe refunds once.
    assert 204 in {r.status_code for r in responses}
    assert {r.status_code for r in responses} <= {204, 409}
    assert len(app.state.stripe.refunds) == 1
    assert len(app.state.stripe.cancelled) == 1
    assert len(_withdrawal_mail(app)) == 1


async def test_a_webhook_still_reporting_the_subscription_active_keeps_premium_ended(
    client, app, settings, make_token, verify_session
) -> None:
    app.state.settings = settings.model_copy(update={"revenuecat_webhook_auth": SecretStr(SECRET)})
    headers = _headers(make_token)
    sub = _sub()
    await _subscribe(client, app, headers, sub)
    assert (await client.post(WITHDRAW, headers=headers)).status_code == 204
    withdrawn = await _grant(verify_session)

    # RevenueCat has not seen the cancellation yet and still reports the old period.
    app.state.revenuecat = FakeRevenueCat({USER: [sub]})
    response = await client.post(
        WEBHOOK,
        json={"api_version": "1.0", "event": {"type": "RENEWAL", "app_user_id": USER}},
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    assert response.status_code == 200
    assert (await client.post(REFRESH, headers=headers)).status_code == 204

    grant = await _grant(verify_session)
    assert grant.expires_at == withdrawn.withdrawn_at
    assert grant.auto_renews is False
    row = _entitlement(await pull(client, headers))
    assert row["premium_source"] != "stripe"
    assert row["withdraw_until"] is None
    entitlement = (await verify_session.scalars(select(Entitlement))).one()
    assert all(g["source"] != "stripe" for g in entitlement.paid_grants)


async def test_no_email_address_still_withdraws_and_sends_nothing(
    client, app, make_token, verify_session
) -> None:
    headers = _headers(make_token, email=None)
    await _subscribe(client, app, headers, _sub())

    response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 204
    assert len(app.state.stripe.refunds) == 1
    assert await _withdrew_at(verify_session) is not None
    assert app.state.mailer.sent == []


async def test_no_mailer_still_withdraws(client, app, make_token, verify_session) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    app.state.mailer = None

    assert (await client.post(WITHDRAW, headers=headers)).status_code == 204

    assert await _withdrew_at(verify_session) is not None


async def test_a_failed_email_logs_and_still_withdraws(
    client, app, make_token, verify_session, caplog
) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    app.state.mailer.error = MailerUnavailableError("down")

    with caplog.at_level(logging.WARNING, logger="crosstune.billing.withdrawal"):
        response = await client.post(WITHDRAW, headers=headers)

    assert response.status_code == 204
    assert await _withdrew_at(verify_session) is not None
    assert any("withdrawal email" in r.getMessage() for r in caplog.records)


async def test_allow_repeat_withdraws_a_second_subscription(
    client, app, make_token, verify_session
) -> None:
    headers = _headers(make_token)
    await _subscribe(client, app, headers, _sub())
    assert (await client.post(WITHDRAW, headers=headers)).status_code == 204
    await _subscribe(client, app, headers, _sub(subscription_id="sub_2"))

    async with app.state.sessionmaker() as session:
        user = (await session.scalars(select(User).where(User.clerk_user_id == USER))).one()
        await withdraw(
            session,
            user,
            app.state.stripe,
            app.state.revenuecat,
            app.state.mailer,
            app.state.settings,
            utc_now(),
            allow_repeat=True,
        )

    assert [key for _, key in app.state.stripe.refunds] == ["withdraw:sub_1", "withdraw:sub_2"]
    assert [key for _, key in _withdrawal_mail(app)] == [
        notice_key("withdrawal", "sub_1", None),
        notice_key("withdrawal", "sub_2", None),
    ]
