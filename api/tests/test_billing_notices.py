"""Purchase confirmations, yearly renewal reminders, and the daily billing-notices run."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from crosstune.billing.emails import notice_key
from crosstune.billing.grants import PaidSubscription
from crosstune.billing.notices import (
    BILLING_NOTICES_RUN,
    claim_billing_notices_run,
    run_billing_notices,
    send_confirmations,
    send_renewal_reminders,
)
from crosstune.db.base import utc_now
from crosstune.db.engine import make_sessionmaker
from crosstune.email.resend import MailerUnavailableError
from crosstune.jobs import runner as runner_module
from crosstune.jobs.runner import JobRunner
from crosstune.models import BillingNotice, Grant, ScheduledRun, User
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantPeriod, GrantSource
from tests.fakes import FakeMailer, FakeObjectStore, FakeRevenueCat, FakeStripe

if TYPE_CHECKING:
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

NOW = datetime(2027, 3, 1, 12, tzinfo=UTC)
EMAIL = "buyer@example.com"
SECRET = "rc-webhook-secret"  # gitleaks:allow -- fixture, not a credential


async def _user(session: AsyncSession, *, email: str | None = EMAIL) -> User:
    user = User(clerk_user_id=f"user_{uuid.uuid4().hex[:8]}", email=email)
    session.add(user)
    await session.flush()
    return user


async def _grant(  # noqa: PLR0913 -- each field is a case the tests vary
    session: AsyncSession,
    user: User,
    *,
    source: GrantSource = GrantSource.STRIPE,
    subscription_id: str = "sub_1",
    period: GrantPeriod | None = GrantPeriod.YEAR,
    expires_at: datetime | None = None,
    auto_renews: bool = True,
    withdrawn_at: datetime | None = None,
) -> Grant:
    grant = Grant(
        user_id=user.id,
        kind=GrantKind.PREMIUM.value,
        source=source.value,
        external_id=subscription_id,
        started_at=NOW - timedelta(days=1),
        period=None if period is None else period.value,
        expires_at=expires_at if expires_at is not None else NOW + timedelta(days=364),
        auto_renews=auto_renews,
        withdrawn_at=withdrawn_at,
    )
    session.add(grant)
    await session.commit()
    return grant


async def _notices(session: AsyncSession) -> list[tuple[str, str, datetime | None]]:
    session.expunge_all()
    rows = await session.execute(
        select(BillingNotice.subscription_id, BillingNotice.kind, BillingNotice.period_end)
    )
    return sorted(rows.tuples().all(), key=lambda row: (row[0], row[1]))


async def test_a_new_stripe_and_a_new_apple_grant_each_get_one_confirmation(
    engine, settings: Settings, verify_session
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    await _grant(verify_session, user, subscription_id="sub_web", period=GrantPeriod.MONTH)
    await _grant(verify_session, user, source=GrantSource.APPLE, subscription_id="sub_app")
    mailer = FakeMailer()

    assert await send_confirmations(sessionmaker, mailer, settings, [user.id], NOW) == 2

    by_key = {key: message for message, key in mailer.sent}
    web = by_key[notice_key("confirmation", "sub_web", None)]
    app = by_key[notice_key("confirmation", "sub_app", None)]
    assert web.to == app.to == EMAIL
    assert "each month" in web.text
    assert "Withdraw for a full refund" in web.text
    assert "each year" in app.text
    assert "Apple Account" in app.text
    assert await _notices(verify_session) == [
        ("sub_app", "confirmation", None),
        ("sub_web", "confirmation", None),
    ]

    assert await send_confirmations(sessionmaker, mailer, settings, [user.id], NOW) == 0
    assert len(mailer.sent) == 2


async def test_a_returning_web_subscriber_is_not_offered_the_withdrawal_again(
    engine, settings: Settings, verify_session
) -> None:
    user = await _user(verify_session)
    user.withdrew_at = NOW - timedelta(days=90)
    await _grant(verify_session, user, subscription_id="sub_again", period=GrantPeriod.MONTH)
    mailer = FakeMailer()

    sent = await send_confirmations(make_sessionmaker(engine), mailer, settings, [user.id], NOW)

    assert sent == 1
    ((message, _key),) = mailer.sent
    assert "each month" in message.text
    assert "Withdraw for a full refund" not in message.text
    assert "refund" not in message.text.lower()


async def test_a_failed_confirmation_leaves_no_notice_and_the_next_pass_sends(
    engine, settings: Settings, verify_session, caplog
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    await _grant(verify_session, user)
    mailer = FakeMailer()
    mailer.error = MailerUnavailableError("Resend answered 500")

    with caplog.at_level(logging.WARNING):
        assert await send_confirmations(sessionmaker, mailer, settings, [user.id], NOW) == 0
    assert await _notices(verify_session) == []
    assert EMAIL not in caplog.text

    mailer.error = None
    assert await run_billing_notices(sessionmaker, mailer, settings, NOW) == 1
    assert await _notices(verify_session) == [("sub_1", "confirmation", None)]


async def test_a_grant_with_no_period_waits_for_one(
    engine, settings: Settings, verify_session, caplog
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    grant = await _grant(verify_session, user, period=None)
    mailer = FakeMailer()

    with caplog.at_level(logging.INFO):
        assert await send_confirmations(sessionmaker, mailer, settings, [user.id], NOW) == 0
    assert mailer.sent == []
    assert any("no billing period" in r.getMessage() for r in caplog.records)

    grant.period = GrantPeriod.MONTH.value
    await verify_session.commit()
    assert await send_confirmations(sessionmaker, mailer, settings, [user.id], NOW) == 1


async def test_withdrawn_trial_and_comp_grants_get_no_confirmation(
    engine, settings: Settings, verify_session
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    await _grant(verify_session, user, withdrawn_at=NOW)
    verify_session.add_all(
        [
            Grant(user_id=user.id, kind="premium", source="trial", expires_at=NOW),
            Grant(user_id=user.id, kind="premium", source="comp", expires_at=None),
        ]
    )
    await verify_session.commit()
    mailer = FakeMailer()

    assert await run_billing_notices(sessionmaker, mailer, settings, NOW) == 0
    assert mailer.sent == []


async def test_a_grant_that_will_not_renew_still_gets_its_confirmation(
    engine, settings: Settings, verify_session
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    await _grant(verify_session, user, auto_renews=False)
    mailer = FakeMailer()

    assert await run_billing_notices(sessionmaker, mailer, settings, NOW) == 1
    assert [key for _, key in mailer.sent] == [notice_key("confirmation", "sub_1", None)]


async def test_a_lapsed_grant_gets_no_confirmation(
    engine, settings: Settings, verify_session
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    await _grant(verify_session, user, expires_at=NOW - timedelta(seconds=1))
    mailer = FakeMailer()

    assert await run_billing_notices(sessionmaker, mailer, settings, NOW) == 0
    assert mailer.sent == []


async def test_the_daily_pass_resends_a_missing_withdrawal_email(
    engine, settings: Settings, verify_session
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    user.withdrew_at = NOW - timedelta(days=1)
    grant = await _grant(verify_session, user, withdrawn_at=user.withdrew_at, auto_renews=False)
    grant.refunded_at = user.withdrew_at
    grant.expires_at = user.withdrew_at
    await verify_session.commit()
    mailer = FakeMailer()

    assert await run_billing_notices(sessionmaker, mailer, settings, NOW) == 1
    ((message, key),) = mailer.sent
    assert message.to == EMAIL
    assert "refunded in full" in message.text
    assert key == notice_key("withdrawal", "sub_1", None)
    assert await _notices(verify_session) == [("sub_1", "withdrawal", None)]

    assert await run_billing_notices(sessionmaker, mailer, settings, NOW) == 0
    assert len(mailer.sent) == 1


async def test_no_email_address_sends_nothing_and_does_not_raise(
    engine, settings: Settings, verify_session
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session, email=None)
    user.withdrew_at = NOW
    await _grant(verify_session, user, expires_at=NOW + timedelta(days=30))
    withdrawn = await _grant(verify_session, user, subscription_id="sub_2", withdrawn_at=NOW)
    withdrawn.refunded_at = NOW
    await verify_session.commit()
    mailer = FakeMailer()

    assert await send_confirmations(sessionmaker, mailer, settings, [user.id], NOW) == 0
    assert await send_renewal_reminders(sessionmaker, mailer, settings, NOW) == 0
    assert await run_billing_notices(sessionmaker, mailer, settings, NOW) == 0
    assert mailer.sent == []
    assert await _notices(verify_session) == []


def _confirmed(subscription_id: str) -> BillingNotice:
    return BillingNotice(
        subscription_id=subscription_id, kind="confirmation", period_end=None, sent_at=NOW
    )


@pytest.mark.parametrize(("days", "sends"), [(24, False), (25, True), (35, True), (36, False)])
async def test_a_reminder_goes_only_25_to_35_days_ahead(
    engine, settings: Settings, verify_session, days: int, *, sends: bool
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    expires_at = NOW + timedelta(days=days)
    await _grant(verify_session, user, expires_at=expires_at)
    verify_session.add(_confirmed("sub_1"))
    await verify_session.commit()
    mailer = FakeMailer()

    assert await send_renewal_reminders(sessionmaker, mailer, settings, NOW) == int(sends)

    if sends:
        ((message, key),) = mailer.sent
        assert key == notice_key("renewal_reminder", "sub_1", expires_at)
        assert message.to == EMAIL
        assert "renews on" in message.subject
        assert await _notices(verify_session) == [
            ("sub_1", "confirmation", None),
            ("sub_1", "renewal_reminder", expires_at),
        ]
    else:
        assert mailer.sent == []


@pytest.mark.parametrize(
    "case",
    ["monthly", "not_renewing", "withdrawn"],
)
async def test_reminders_skip_monthly_non_renewing_and_withdrawn(
    engine, settings: Settings, verify_session, case: str
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    await _grant(
        verify_session,
        user,
        expires_at=NOW + timedelta(days=30),
        period=GrantPeriod.MONTH if case == "monthly" else GrantPeriod.YEAR,
        auto_renews=case != "not_renewing",
        withdrawn_at=NOW - timedelta(days=1) if case == "withdrawn" else None,
    )
    mailer = FakeMailer()

    assert await send_renewal_reminders(sessionmaker, mailer, settings, NOW) == 0
    assert mailer.sent == []


async def test_one_reminder_per_renewal_and_a_new_one_a_year_on(
    engine, settings: Settings, verify_session
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    first_end = NOW + timedelta(days=30)
    grant = await _grant(verify_session, user, expires_at=first_end)
    mailer = FakeMailer()

    assert await send_renewal_reminders(sessionmaker, mailer, settings, NOW) == 1
    later = NOW + timedelta(days=3)
    assert await send_renewal_reminders(sessionmaker, mailer, settings, later) == 0

    grant.expires_at = first_end + timedelta(days=365)
    await verify_session.commit()
    a_year_on = NOW + timedelta(days=365)
    assert await send_renewal_reminders(sessionmaker, mailer, settings, a_year_on) == 1
    keys = [key for _, key in mailer.sent]
    assert keys == [
        notice_key("renewal_reminder", "sub_1", first_end),
        notice_key("renewal_reminder", "sub_1", grant.expires_at),
    ]


async def test_a_shifted_renewal_date_gets_no_second_reminder(
    engine, settings: Settings, verify_session
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    first_end = NOW + timedelta(days=30)
    grant = await _grant(verify_session, user, expires_at=first_end)
    mailer = FakeMailer()
    assert await send_renewal_reminders(sessionmaker, mailer, settings, NOW) == 1

    grant.expires_at = first_end + timedelta(hours=26)
    await verify_session.commit()
    later = NOW + timedelta(days=1)

    assert await send_renewal_reminders(sessionmaker, mailer, settings, later) == 0
    assert len(mailer.sent) == 1


async def test_a_failed_reminder_leaves_no_notice(
    engine, settings: Settings, verify_session
) -> None:
    sessionmaker = make_sessionmaker(engine)
    user = await _user(verify_session)
    await _grant(verify_session, user, expires_at=NOW + timedelta(days=30))
    verify_session.add(_confirmed("sub_1"))
    await verify_session.commit()
    mailer = FakeMailer()
    mailer.error = MailerUnavailableError("Resend answered 500")

    assert await send_renewal_reminders(sessionmaker, mailer, settings, NOW) == 0
    assert await _notices(verify_session) == [("sub_1", "confirmation", None)]

    mailer.error = None
    assert await send_renewal_reminders(sessionmaker, mailer, settings, NOW) == 1


async def test_one_failing_account_leaves_the_others(
    engine, settings: Settings, verify_session, monkeypatch
) -> None:
    sessionmaker = make_sessionmaker(engine)
    first = await _user(verify_session, email="first@example.com")
    second = await _user(verify_session, email="second@example.com")
    await _grant(verify_session, first, subscription_id="sub_a")
    await _grant(verify_session, second, subscription_id="sub_b")
    mailer = FakeMailer()
    real_send = mailer.send

    async def flaky(message, *, idempotency_key: str) -> None:
        if message.to == "first@example.com":
            msg = "unexpected"
            raise RuntimeError(msg)
        await real_send(message, idempotency_key=idempotency_key)

    monkeypatch.setattr(mailer, "send", flaky)

    assert await run_billing_notices(sessionmaker, mailer, settings, NOW) == 1
    assert [message.to for message, _ in mailer.sent] == ["second@example.com"]


# --- After a refresh commits ---


def _web_sub(
    subscription_id: str = "sub_1", *, started: timedelta = timedelta(0)
) -> PaidSubscription:
    now = utc_now()
    return PaidSubscription(
        subscription_id=subscription_id,
        store_id=f"si_{subscription_id}",
        source=GrantSource.STRIPE,
        kind=GrantKind.PREMIUM,
        environment=GrantEnvironment.PRODUCTION,
        expires_at=now + timedelta(days=30),
        auto_renews=True,
        started_at=now - started,
        period=GrantPeriod.MONTH,
    )


@pytest.fixture
def webhook_app(app: FastAPI, settings: Settings) -> FastAPI:
    app.state.settings = settings.model_copy(update={"revenuecat_webhook_auth": SecretStr(SECRET)})
    return app


async def test_the_webhook_sends_the_confirmation_after_commit(
    client, webhook_app, make_token, verify_session
) -> None:
    headers = {"Authorization": f"Bearer {make_token('user_a', email=EMAIL)}"}
    assert (await client.get("/v1/me", headers=headers)).status_code == 200
    webhook_app.state.revenuecat = FakeRevenueCat({"user_a": [_web_sub()]})
    sent_with_grant: list[bool] = []
    mailer: FakeMailer = webhook_app.state.mailer
    real_send = mailer.send

    async def send(message, *, idempotency_key: str) -> None:
        # A separate session sees the grant only once the refresh committed.
        async with make_sessionmaker(webhook_app.state.engine)() as session:
            grant = await session.scalar(select(Grant.id).where(Grant.external_id == "sub_1"))
        sent_with_grant.append(grant is not None)
        await real_send(message, idempotency_key=idempotency_key)

    mailer.send = send  # ty: ignore[invalid-assignment]

    response = await client.post(
        "/v1/webhooks/revenuecat",
        json={"event": {"type": "INITIAL_PURCHASE", "app_user_id": "user_a"}},
        headers={"Authorization": f"Bearer {SECRET}"},
    )

    assert response.status_code == 200
    assert sent_with_grant == [True]
    ((message, key),) = mailer.sent
    assert message.to == EMAIL
    assert key == notice_key("confirmation", "sub_1", None)
    assert await _notices(verify_session) == [("sub_1", "confirmation", None)]

    again = await client.post(
        "/v1/webhooks/revenuecat",
        json={"event": {"type": "RENEWAL", "app_user_id": "user_a"}},
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    assert again.status_code == 200
    assert len(mailer.sent) == 1


async def test_the_refresh_route_sends_the_confirmation_and_a_failed_send_still_succeeds(
    client, app, make_token, verify_session
) -> None:
    headers = {"Authorization": f"Bearer {make_token('user_a', email=EMAIL)}"}
    app.state.revenuecat = FakeRevenueCat({"user_a": [_web_sub()]})
    app.state.mailer.error = MailerUnavailableError("Resend answered 500")

    assert (await client.post("/v1/me/billing/refresh", headers=headers)).status_code == 204
    assert await _notices(verify_session) == []

    app.state.mailer.error = None
    assert (await client.post("/v1/me/billing/refresh", headers=headers)).status_code == 204
    ((message, key),) = app.state.mailer.sent
    assert message.to == EMAIL
    assert key == notice_key("confirmation", "sub_1", None)


async def test_an_unexpected_send_error_never_fails_the_refresh(
    client, app, make_token, monkeypatch
) -> None:
    headers = {"Authorization": f"Bearer {make_token('user_a', email=EMAIL)}"}
    app.state.revenuecat = FakeRevenueCat({"user_a": [_web_sub()]})
    monkeypatch.setattr(
        "crosstune.billing.router.send_confirmations", AsyncMock(side_effect=RuntimeError("boom"))
    )

    assert (await client.post("/v1/me/billing/refresh", headers=headers)).status_code == 204


# --- The withdrawal notice ---


async def test_a_withdrawal_records_its_notice(client, app, make_token, verify_session) -> None:
    headers = {"Authorization": f"Bearer {make_token('user_a', email=EMAIL)}"}
    app.state.revenuecat = FakeRevenueCat({"user_a": [_web_sub()]})
    assert (await client.post("/v1/me/billing/refresh", headers=headers)).status_code == 204

    assert (await client.post("/v1/me/billing/withdraw", headers=headers)).status_code == 204

    assert await _notices(verify_session) == [
        ("sub_1", "confirmation", None),
        ("sub_1", "withdrawal", None),
    ]


async def test_an_account_deletion_refund_records_its_notice(
    client, app, make_token, verify_session
) -> None:
    headers = {"Authorization": f"Bearer {make_token('user_a', email=EMAIL)}"}
    app.state.revenuecat = FakeRevenueCat({"user_a": [_web_sub()]})
    assert (await client.post("/v1/me/billing/refresh", headers=headers)).status_code == 204

    assert (await client.delete("/v1/me", headers=headers)).status_code == 204

    assert await verify_session.scalar(select(User.id)) is None
    assert await _notices(verify_session) == [("sub_1", "withdrawal", None)]
    assert [key for _, key in app.state.mailer.sent][-1] == notice_key("withdrawal", "sub_1", None)


async def test_an_account_deletion_removes_its_confirmations_and_reminders(
    client, app, make_token, verify_session
) -> None:
    headers = {"Authorization": f"Bearer {make_token('user_a', email=EMAIL)}"}
    app.state.revenuecat = FakeRevenueCat({"user_a": [_web_sub(started=timedelta(days=20))]})
    assert (await client.post("/v1/me/billing/refresh", headers=headers)).status_code == 204
    renewal = NOW + timedelta(days=30)
    verify_session.add_all(
        [
            BillingNotice(
                subscription_id="sub_1", kind="renewal_reminder", period_end=renewal, sent_at=NOW
            ),
            BillingNotice(subscription_id="sub_1", kind="withdrawal", period_end=None, sent_at=NOW),
            _confirmed("sub_someone_else"),
        ]
    )
    await verify_session.commit()

    assert (await client.delete("/v1/me", headers=headers)).status_code == 204

    assert app.state.stripe.refunds == []
    assert await _notices(verify_session) == [
        ("sub_1", "withdrawal", None),
        ("sub_someone_else", "confirmation", None),
    ]


# --- The daily run ---


def _runner(engine, settings: Settings, **clients: object) -> JobRunner:
    return JobRunner(
        make_sessionmaker(engine),
        FakeObjectStore(),
        orphan_sweep_seconds=None,
        settings=settings,
        **clients,  # ty: ignore[invalid-argument-type]
    )


async def test_the_daily_run_never_runs_without_mail_or_billing(
    engine, settings: Settings, verify_session, monkeypatch
) -> None:
    notices = AsyncMock(return_value=0)
    withdrawals = AsyncMock(return_value=0)
    monkeypatch.setattr(runner_module, "run_billing_notices", notices)
    monkeypatch.setattr(runner_module, "complete_pending_withdrawals", withdrawals)
    job_runner = _runner(engine, settings, stripe=FakeStripe())

    assert await job_runner.run_once() == 0
    assert await job_runner.next_due() == datetime.max.replace(tzinfo=UTC)
    notices.assert_not_awaited()
    withdrawals.assert_not_awaited()
    assert await verify_session.scalar(select(ScheduledRun)) is None


async def test_the_daily_run_sends_notices_and_finishes_withdrawals_once_a_day(
    engine, settings: Settings, verify_session, monkeypatch
) -> None:
    notices = AsyncMock(return_value=0)
    withdrawals = AsyncMock(return_value=0)
    monkeypatch.setattr(runner_module, "run_billing_notices", notices)
    monkeypatch.setattr(runner_module, "complete_pending_withdrawals", withdrawals)
    mailer, stripe, revenuecat = FakeMailer(), FakeStripe(), FakeRevenueCat()
    job_runner = _runner(engine, settings, mailer=mailer, stripe=stripe, revenuecat=revenuecat)

    before = utc_now()
    assert await job_runner.run_once() == 1
    task = job_runner.billing_notices_task
    assert task is not None
    await task
    assert await job_runner.run_once() == 0

    withdrawals.assert_awaited_once()
    w_args = withdrawals.await_args.args
    assert w_args[1:5] == (stripe, revenuecat, mailer, settings)
    notices.assert_awaited_once()
    n_args = notices.await_args.args
    assert n_args[1:3] == (mailer, settings)
    assert before <= n_args[3] <= utc_now()
    stored = await verify_session.scalar(
        select(ScheduledRun.next_run_at).where(ScheduledRun.name == BILLING_NOTICES_RUN)
    )
    assert stored == n_args[3] + timedelta(days=1)
    assert await job_runner.next_due() == stored


async def test_the_daily_run_finishes_withdrawals_without_a_mailer(
    engine, settings: Settings, truncate_all: None, monkeypatch
) -> None:
    notices = AsyncMock(return_value=0)
    withdrawals = AsyncMock(return_value=0)
    monkeypatch.setattr(runner_module, "run_billing_notices", notices)
    monkeypatch.setattr(runner_module, "complete_pending_withdrawals", withdrawals)
    job_runner = _runner(engine, settings, stripe=FakeStripe(), revenuecat=FakeRevenueCat())

    assert await job_runner.run_once() == 1
    assert job_runner.billing_notices_task is not None
    await job_runner.billing_notices_task

    withdrawals.assert_awaited_once()
    assert withdrawals.await_args.args[3] is None
    notices.assert_not_awaited()


async def test_the_daily_run_sends_notices_without_billing_clients(
    engine, settings: Settings, truncate_all: None, monkeypatch
) -> None:
    notices = AsyncMock(return_value=0)
    withdrawals = AsyncMock(return_value=0)
    monkeypatch.setattr(runner_module, "run_billing_notices", notices)
    monkeypatch.setattr(runner_module, "complete_pending_withdrawals", withdrawals)
    job_runner = _runner(engine, settings, mailer=FakeMailer())

    assert await job_runner.run_once() == 1
    assert job_runner.billing_notices_task is not None
    await job_runner.billing_notices_task

    notices.assert_awaited_once()
    withdrawals.assert_not_awaited()


async def test_a_failing_withdrawal_pass_still_sends_notices(
    engine, settings: Settings, truncate_all: None, monkeypatch, caplog
) -> None:
    notices = AsyncMock(return_value=0)
    withdrawals = AsyncMock(side_effect=RuntimeError("boom"))
    monkeypatch.setattr(runner_module, "run_billing_notices", notices)
    monkeypatch.setattr(runner_module, "complete_pending_withdrawals", withdrawals)
    job_runner = _runner(
        engine, settings, mailer=FakeMailer(), stripe=FakeStripe(), revenuecat=FakeRevenueCat()
    )

    with caplog.at_level(logging.ERROR):
        assert await job_runner.run_once() == 1
        assert job_runner.billing_notices_task is not None
        await job_runner.billing_notices_task

    notices.assert_awaited_once()
    assert any("pending withdrawals" in r.getMessage() for r in caplog.records)


async def test_only_one_process_claims_the_daily_run(engine, truncate_all: None) -> None:
    sessionmaker = make_sessionmaker(engine)
    assert await claim_billing_notices_run(sessionmaker, NOW) is True
    assert await claim_billing_notices_run(sessionmaker, NOW) is False
    assert await claim_billing_notices_run(sessionmaker, NOW + timedelta(days=1)) is True


async def test_the_loop_wakes_when_the_daily_run_ends(
    engine, settings: Settings, truncate_all: None, monkeypatch
) -> None:
    started, release = asyncio.Event(), asyncio.Event()

    async def slow_pass(*_args: object, **_kwargs: object) -> int:
        started.set()
        await release.wait()
        return 0

    monkeypatch.setattr(runner_module, "run_billing_notices", slow_pass)
    job_runner = _runner(engine, settings, mailer=FakeMailer())
    real_run_once = job_runner.run_once
    passes: list[int] = []
    idle, woken = asyncio.Event(), asyncio.Event()

    async def run_once() -> int:
        done = await real_run_once()
        passes.append(done)
        if done == 0 and not release.is_set():
            idle.set()
        if release.is_set():
            woken.set()
        return done

    monkeypatch.setattr(job_runner, "run_once", run_once)
    job_runner.start()
    await asyncio.wait_for(started.wait(), timeout=5)
    # The loop found no more work and sleeps; with no due time it would sleep for good.
    await asyncio.wait_for(idle.wait(), timeout=5)

    release.set()
    await asyncio.wait_for(woken.wait(), timeout=5)
    await job_runner.stop()


async def test_a_failed_withdrawal_notice_check_never_fails_the_withdrawal(
    client, app, make_token, verify_session, monkeypatch, caplog
) -> None:
    headers = {"Authorization": f"Bearer {make_token('user_a', email=EMAIL)}"}
    app.state.revenuecat = FakeRevenueCat({"user_a": [_web_sub()]})
    assert (await client.post("/v1/me/billing/refresh", headers=headers)).status_code == 204
    monkeypatch.setattr(
        "crosstune.billing.withdrawal.notice_recorded",
        AsyncMock(side_effect=OperationalError("select", {}, Exception("down"))),
    )

    with caplog.at_level(logging.ERROR):
        response = await client.post("/v1/me/billing/withdraw", headers=headers)

    assert response.status_code == 204
    assert await verify_session.scalar(select(User.withdrew_at)) is not None
    assert any("sent withdrawal email" in r.getMessage() for r in caplog.records)
