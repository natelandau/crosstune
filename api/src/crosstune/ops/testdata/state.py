"""Put a test account into a billing state."""

from __future__ import annotations

from contextlib import suppress
from datetime import timedelta
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import or_, select

from crosstune.billing.access import refresh_entitlement
from crosstune.billing.grants import grant_comp, revoke_comp, set_trial_end, start_trial
from crosstune.db.base import bump_server_seq
from crosstune.db.locks import lock_user
from crosstune.models import Entitlement, Grant
from crosstune.ops.testdata.errors import DataCommandError
from crosstune.ops.testdata.seed import GRANTED_BY
from crosstune.vocabulary import GrantKind, GrantSource

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

_STORE_SOURCES = (GrantSource.APPLE.value, GrantSource.STRIPE.value)
PREMIUM_REASON = "just api::testdata --state premium"


class AccountState(StrEnum):
    """The billing states a test account can be put in."""

    TRIAL = "trial"
    PREMIUM = "premium"
    LAPSED = "lapsed"


async def refuse_store_subscription(
    session: AsyncSession, user_id: uuid.UUID, now: datetime
) -> None:
    """Refuse an account whose billing state a grant change cannot set.

    Raises:
        DataCommandError: An Apple or Stripe subscription is active, which outranks
            every grant this command writes.
    """
    source = await session.scalar(
        select(Grant.source)
        .where(
            Grant.user_id == user_id,
            Grant.kind == GrantKind.PREMIUM.value,
            Grant.source.in_(_STORE_SOURCES),
            or_(Grant.expires_at.is_(None), Grant.expires_at > now),
        )
        .limit(1)
    )
    if source is not None:
        msg = f"this account has an active {source} subscription; cancel it in the sandbox first"
        raise DataCommandError(msg)


async def _reset_notice_marks(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> None:
    row = (
        await session.execute(
            select(Entitlement)
            .where(Entitlement.user_id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        return
    if any(
        mark is not None
        for mark in (
            row.recording_notice_seen_at,
            row.trial_reminder_seen_at,
            row.trial_end_seen_at,
        )
    ):
        row.recording_notice_seen_at = None
        row.trial_reminder_seen_at = None
        row.trial_end_seen_at = None
        row.updated_at = now
        bump_server_seq(row)
        await session.flush()


async def apply_state(
    session: AsyncSession,
    user_id: uuid.UUID,
    state: AccountState,
    settings: Settings,
    now: datetime,
) -> None:
    """Move the account into `state` and clear the notices it has already seen.

    Raises:
        DataCommandError: An Apple or Stripe subscription is active, which a grant
            change cannot override.
    """
    await lock_user(session, user_id)
    await refuse_store_subscription(session, user_id, now)

    match state:
        case AccountState.TRIAL:
            await revoke_comp(session, user_id, now)
            try:
                await set_trial_end(
                    session,
                    user_id,
                    now + timedelta(days=settings.trial_days),
                    starts_at=now,
                )
            except LookupError:
                await start_trial(session, user_id, settings, now)
        case AccountState.PREMIUM:
            await grant_comp(
                session,
                user_id,
                expires_at=None,
                storage_addon=False,
                granted_by=GRANTED_BY,
                reason=PREMIUM_REASON,
                now=now,
            )
        case AccountState.LAPSED:
            await revoke_comp(session, user_id, now)
            # An account with no trial grant is already lapsed once its comp ends.
            with suppress(LookupError):
                await set_trial_end(session, user_id, now)

    await _reset_notice_marks(session, user_id, now)
    await refresh_entitlement(session, user_id, settings, now)
