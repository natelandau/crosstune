"""The inactivity rule: which step an account is on, from fixed instants."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from crosstune.inactivity.rules import (
    FIRST_NOTICE,
    INACTIVE_AFTER,
    SECOND_NOTICE,
    NoticeState,
    Step,
    deletion_due,
    next_step,
)

T = datetime(2025, 1, 1, 12, 0, tzinfo=UTC)
DAY = timedelta(days=1)
MINUTE = timedelta(minutes=1)


def step(
    now: datetime,
    notice: NoticeState | None = None,
    *,
    active_since: datetime = T,
    premium: bool = False,
    holds_files: bool = True,
) -> Step:
    return next_step(
        now=now,
        active_since=active_since,
        premium=premium,
        holds_files=holds_files,
        notice=notice,
    )


def notice(
    first: datetime | None = None,
    second: datetime | None = None,
    due: datetime | None = None,
    *,
    active_since: datetime = T,
) -> NoticeState:
    return NoticeState(
        active_since=active_since,
        first_sent_at=first,
        second_sent_at=second,
        deletion_due_at=due,
    )


def test_constants() -> None:
    assert timedelta(days=365) == INACTIVE_AFTER
    assert timedelta(days=30) == FIRST_NOTICE
    assert timedelta(days=7) == SECOND_NOTICE


def test_on_schedule() -> None:
    assert step(T + 335 * DAY - MINUTE) is Step.NONE
    assert step(T + 335 * DAY) is Step.FIRST
    first = T + 335 * DAY
    due = deletion_due(now=first, active_since=T, notice=None)
    assert due == T + 365 * DAY
    n1 = notice(first, None, due)

    assert step(T + 358 * DAY - MINUTE, n1) is Step.NONE
    assert step(T + 358 * DAY, n1) is Step.SECOND
    second = T + 358 * DAY
    due = deletion_due(now=second, active_since=T, notice=n1)
    assert due == T + 365 * DAY
    n2 = notice(first, second, due)

    assert step(T + 365 * DAY - MINUTE, n2) is Step.NONE
    assert step(T + 365 * DAY, n2) is Step.DELETE


def test_a_late_first_warning_pushes_deletion() -> None:
    now = T + 400 * DAY
    assert step(now) is Step.FIRST
    assert deletion_due(now=now, active_since=T, notice=None) == T + 430 * DAY


def test_a_late_pass_never_warns_and_deletes_together() -> None:
    first = T + 335 * DAY
    n1 = notice(first, None, T + 365 * DAY)
    late = T + 500 * DAY
    assert step(late, n1) is Step.SECOND
    due = deletion_due(now=late, active_since=T, notice=n1)
    assert due == late + SECOND_NOTICE
    n2 = notice(first, late, due)
    assert step(late + SECOND_NOTICE - MINUTE, n2) is Step.NONE
    assert step(late + SECOND_NOTICE, n2) is Step.DELETE


def test_second_warning_uses_stored_due_date_when_later() -> None:
    n1 = notice(T + 400 * DAY, None, T + 430 * DAY)
    assert step(T + 423 * DAY - MINUTE, n1) is Step.NONE
    assert step(T + 423 * DAY, n1) is Step.SECOND
    assert deletion_due(now=T + 423 * DAY, active_since=T, notice=n1) == T + 430 * DAY


def test_delete_needs_seven_days_after_second_even_if_due_passed() -> None:
    second = T + 600 * DAY
    n2 = notice(T + 335 * DAY, second, T + 365 * DAY)
    assert step(second + SECOND_NOTICE - MINUTE, n2) is Step.NONE
    assert step(second + SECOND_NOTICE, n2) is Step.DELETE


def test_delete_needs_due_date_reached() -> None:
    second = T + 358 * DAY
    n2 = notice(T + 335 * DAY, second, T + 400 * DAY)
    assert step(T + 400 * DAY - MINUTE, n2) is Step.NONE
    assert step(T + 400 * DAY, n2) is Step.DELETE


@pytest.mark.parametrize("now_days", [0, 335, 358, 365, 500, 5000])
@pytest.mark.parametrize("second", [None, T + 358 * DAY])
def test_first_sent_without_due_date_does_nothing(now_days: int, second: datetime | None) -> None:
    n = notice(T + 335 * DAY, second, None)
    assert step(T + now_days * DAY, n) is Step.NONE


@pytest.mark.parametrize("now_days", [0, 335, 358, 365, 500, 5000])
def test_never_second_or_delete_without_first(now_days: int) -> None:
    n = notice(None, T + 300 * DAY, T + 310 * DAY)
    assert step(T + now_days * DAY, n) in {Step.NONE, Step.FIRST}


@pytest.mark.parametrize("now_days", [0, 335, 358, 365, 500, 5000])
def test_never_delete_without_second(now_days: int) -> None:
    n = notice(T + 335 * DAY, None, T + 365 * DAY)
    assert step(T + now_days * DAY, n) is not Step.DELETE


def test_a_sync_resets() -> None:
    n = notice(T + 335 * DAY, T + 358 * DAY, T + 365 * DAY)
    assert step(T + 366 * DAY, n, active_since=T + 360 * DAY) is Step.RESET


def test_premium_resets() -> None:
    n = notice(T + 335 * DAY, T + 358 * DAY, T + 365 * DAY)
    assert step(T + 366 * DAY, n, premium=True) is Step.RESET


def test_emptied_resets() -> None:
    n = notice(T + 335 * DAY, T + 358 * DAY, T + 365 * DAY)
    assert step(T + 366 * DAY, n, holds_files=False) is Step.RESET


def test_reset_wins_over_a_due_deletion() -> None:
    n = notice(T + 335 * DAY, T + 358 * DAY, T + 365 * DAY)
    assert step(T + 9999 * DAY, n, premium=True, holds_files=False) is Step.RESET


@pytest.mark.parametrize(("premium", "holds_files"), [(True, True), (False, False), (True, False)])
def test_no_notice_and_not_eligible_is_none(*, premium: bool, holds_files: bool) -> None:
    assert step(T + 9999 * DAY, premium=premium, holds_files=holds_files) is Step.NONE


def test_active_account_is_none() -> None:
    assert step(T + 10 * DAY) is Step.NONE


def test_stale_notice_without_warnings_resets() -> None:
    assert step(T + 400 * DAY, notice(), active_since=T + 1 * DAY) is Step.RESET


def test_a_notice_with_no_first_warning_gets_the_first() -> None:
    assert step(T + 335 * DAY, notice()) is Step.FIRST
    assert deletion_due(now=T + 335 * DAY, active_since=T, notice=notice()) == T + 365 * DAY


def test_deletion_due_when_both_sent_is_the_stored_date() -> None:
    n2 = notice(T + 335 * DAY, T + 358 * DAY, T + 400 * DAY)
    assert deletion_due(now=T + 999 * DAY, active_since=T, notice=n2) == T + 400 * DAY


@pytest.mark.parametrize("second", [None, T + 358 * DAY])
def test_deletion_due_raises_without_stored_date(second: datetime | None) -> None:
    n = notice(T + 335 * DAY, second, None)
    with pytest.raises(ValueError, match="no deletion date"):
        deletion_due(now=T + 423 * DAY, active_since=T, notice=n)
