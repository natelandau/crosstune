"""The inactive-account rule, as pure functions of fixed instants.

Deleting recordings and scans is irreversible, so deletion is only ever the
step after both warnings were sent and recorded, at least `SECOND_NOTICE`
after the second one, and never before the recorded deletion date.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

INACTIVE_AFTER = timedelta(days=365)
FIRST_NOTICE = timedelta(days=30)
SECOND_NOTICE = timedelta(days=7)


class Step(StrEnum):
    """What the daily pass does next for one account."""

    NONE = "none"
    FIRST = "first"
    SECOND = "second"
    DELETE = "delete"
    RESET = "reset"


@dataclass(frozen=True)
class NoticeState:
    """The stored warnings for an account, mirroring `InactivityNotice`."""

    active_since: datetime
    first_sent_at: datetime | None
    second_sent_at: datetime | None
    deletion_due_at: datetime | None


def next_step(
    *,
    now: datetime,
    active_since: datetime,
    premium: bool,
    holds_files: bool,
    notice: NoticeState | None,
) -> Step:
    """Return the step due for an account at `now`."""
    if notice is not None and (notice.active_since != active_since or premium or not holds_files):
        return Step.RESET
    if premium or not holds_files:
        return Step.NONE

    if notice is None or notice.first_sent_at is None:
        due_for_first = now >= active_since + INACTIVE_AFTER - FIRST_NOTICE
        return Step.FIRST if due_for_first else Step.NONE

    due = notice.deletion_due_at
    if due is None:
        return Step.NONE
    if notice.second_sent_at is None:
        return Step.SECOND if now >= due - SECOND_NOTICE else Step.NONE
    deletable = now >= due and now >= notice.second_sent_at + SECOND_NOTICE
    return Step.DELETE if deletable else Step.NONE


def deletion_due(*, now: datetime, active_since: datetime, notice: NoticeState | None) -> datetime:
    """Return the deletion date to record when sending the next warning at `now`.

    Also the date to print in that warning. Once both warnings are sent it is
    the stored date, unchanged.

    Raises:
        ValueError: The first warning is recorded but the notice has no deletion date.
    """
    if notice is None or notice.first_sent_at is None:
        return max(active_since + INACTIVE_AFTER, now + FIRST_NOTICE)
    if notice.deletion_due_at is None:
        msg = "notice has a first warning but no deletion date"
        raise ValueError(msg)
    if notice.second_sent_at is None:
        return max(notice.deletion_due_at, now + SECOND_NOTICE)
    return notice.deletion_due_at
