"""Deleting a deleted account's PostHog person through the job runner."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from crosstune.analytics.posthog import AnalyticsUnavailableError
from crosstune.db.base import utc_now
from crosstune.db.engine import make_sessionmaker
from crosstune.jobs import analytics as analytics_module
from crosstune.jobs.runner import JobRunner
from crosstune.models import AnalyticsDeletion
from tests.fakes import FakeAnalyticsPersons, FakeObjectStore

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

LATER_PASSES = (timedelta(minutes=10), timedelta(days=1), timedelta(days=7))


@pytest.fixture
def persons() -> FakeAnalyticsPersons:
    return FakeAnalyticsPersons()


@pytest.fixture
def runner(engine, tmp_path, settings: Settings, persons: FakeAnalyticsPersons) -> JobRunner:
    return JobRunner(
        make_sessionmaker(engine),
        FakeObjectStore(),
        work_root=tmp_path,
        analytics_persons=persons,
        settings=settings,
    )


async def _rows(verify_session: AsyncSession) -> list[AnalyticsDeletion]:
    stmt = (
        select(AnalyticsDeletion)
        .order_by(AnalyticsDeletion.locked_until.nulls_first())
        .execution_options(populate_existing=True)
    )
    return list(await verify_session.scalars(stmt))


async def _schedule(verify_session: AsyncSession, distinct_id: str = "user_gone") -> None:
    analytics_module.schedule_person_deletion(
        verify_session, distinct_id, later_passes_after=LATER_PASSES
    )
    await verify_session.commit()


async def test_scheduling_queues_a_delete_now_and_one_after_each_delay(
    truncate_all: None, verify_session: AsyncSession
) -> None:
    before = utc_now()
    await _schedule(verify_session)

    now_pass, *later = await _rows(verify_session)
    assert {row.distinct_id for row in [now_pass, *later]} == {"user_gone"}
    assert now_pass.locked_until is None
    assert len(later) == len(LATER_PASSES)
    for row, delay in zip(later, LATER_PASSES, strict=True):
        assert row.locked_until is not None
        assert before + delay <= row.locked_until <= utc_now() + delay


async def test_the_runner_deletes_the_person_and_holds_the_later_passes(
    truncate_all: None, verify_session: AsyncSession, runner: JobRunner, persons
) -> None:
    await _schedule(verify_session)

    await runner.run_once()

    assert persons.deleted == ["user_gone"]
    remaining = await _rows(verify_session)
    assert len(remaining) == len(LATER_PASSES)
    assert all(row.locked_until is not None and row.attempts == 0 for row in remaining)
    assert await runner.next_due() == remaining[0].locked_until


async def test_each_later_pass_deletes_again_once_due(
    truncate_all: None, verify_session: AsyncSession, runner: JobRunner, persons
) -> None:
    await _schedule(verify_session)
    await runner.run_once()

    for ran in range(1, len(LATER_PASSES) + 1):
        due, *held = await _rows(verify_session)
        due.locked_until = utc_now() - timedelta(seconds=1)
        await verify_session.commit()

        await runner.run_once()

        assert persons.deleted == ["user_gone"] * (ran + 1)
        assert [row.id for row in await _rows(verify_session)] == [row.id for row in held]

    assert await _rows(verify_session) == []


@pytest.mark.parametrize("index", range(len(LATER_PASSES)))
async def test_a_later_pass_that_fails_backs_off_and_retries(
    truncate_all: None, verify_session: AsyncSession, runner: JobRunner, persons, index: int
) -> None:
    await _schedule(verify_session)
    await runner.run_once()
    failing = (await _rows(verify_session))[index]
    failing.locked_until = utc_now() - timedelta(seconds=1)
    await verify_session.commit()
    persons.error = AnalyticsUnavailableError("PostHog could not delete user_gone")

    await runner.run_once()

    retried = next(row for row in await _rows(verify_session) if row.id == failing.id)
    assert retried.attempts == 1
    assert retried.locked_until is not None
    assert retried.locked_until > utc_now()
    assert retried.last_error == "PostHog could not delete user_gone"

    persons.error = None
    retried.locked_until = None
    await verify_session.commit()
    await runner.run_once()

    assert persons.deleted == ["user_gone", "user_gone"]
    assert failing.id not in {row.id for row in await _rows(verify_session)}


async def test_a_failed_delete_backs_off_and_retries(
    truncate_all: None, verify_session: AsyncSession, runner: JobRunner, persons, caplog
) -> None:
    verify_session.add(AnalyticsDeletion(distinct_id="user_gone", attempts=0))
    await verify_session.commit()
    persons.error = AnalyticsUnavailableError("PostHog could not delete user_gone")

    with caplog.at_level(logging.WARNING, logger=analytics_module.log.name):
        await runner.run_once()

    (failed,) = await _rows(verify_session)
    assert failed.attempts == 1
    assert failed.locked_until is not None
    assert failed.locked_until > utc_now()
    assert failed.last_error == "PostHog could not delete user_gone"
    assert persons.deleted == []
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert [r.name for r in warnings] == [analytics_module.log.name]
    assert warnings[0].person == "user_gone"

    persons.error = None
    failed.locked_until = None
    await verify_session.commit()
    await runner.run_once()

    assert persons.deleted == ["user_gone"]
    assert await _rows(verify_session) == []


async def test_a_delete_that_keeps_failing_is_given_up(
    truncate_all: None, verify_session: AsyncSession, runner: JobRunner, persons, caplog
) -> None:
    verify_session.add(AnalyticsDeletion(distinct_id="user_gone", attempts=0))
    await verify_session.commit()
    persons.error = AnalyticsUnavailableError("down")

    with caplog.at_level(logging.ERROR, logger=analytics_module.log.name):
        for _ in range(analytics_module.MAX_ATTEMPTS):
            for row in await _rows(verify_session):
                row.locked_until = None
            await verify_session.commit()
            await runner.run_once()

    assert await _rows(verify_session) == []
    assert any(r.levelno == logging.ERROR for r in caplog.records)


async def test_a_pass_whose_attempts_never_finished_is_dropped(
    truncate_all: None, verify_session: AsyncSession, runner: JobRunner, persons
) -> None:
    verify_session.add(
        AnalyticsDeletion(distinct_id="user_gone", attempts=analytics_module.MAX_ATTEMPTS)
    )
    await verify_session.commit()

    await runner.run_once()

    assert persons.deleted == []
    assert await _rows(verify_session) == []


async def test_a_runner_without_posthog_leaves_the_deletions_queued(
    truncate_all: None, verify_session: AsyncSession, engine, tmp_path, settings: Settings
) -> None:
    await _schedule(verify_session)
    runner = JobRunner(
        make_sessionmaker(engine), FakeObjectStore(), work_root=tmp_path, settings=settings
    )

    assert await runner.run_once() == 0
    rows = await _rows(verify_session)
    assert [row.attempts for row in rows] == [0] * (len(LATER_PASSES) + 1)
    # The idle loop never wakes for a deletion it cannot run.
    assert await runner.next_due() not in {row.locked_until for row in rows}
