"""Cut the waiting pieces of a parent recording's split, and narrow its original once all are cut."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import select

from crosstune.db.locks import lock_user
from crosstune.jobs.attempt import attempt_timeout, load_parent
from crosstune.jobs.recovery import (
    Orphans,
    recover_failed_audio_rewrite,
    release_backup_copy,
    release_cancelled,
)
from crosstune.jobs.split import (
    ParentFiles,
    back_up_parent,
    complete_split,
    cut_piece,
    list_unnamed_originals,
)
from crosstune.models import Job, Recording
from crosstune.recordings.service import ensure_split_job, ensure_trim_job
from crosstune.recordings.split_rules import (
    fail_waiting_pieces,
    split_ready_to_complete,
    waiting_pieces,
)
from crosstune.storage.store import delete_best_effort
from crosstune.vocabulary import SPLIT_FAILED

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext

log = logging.getLogger(__name__)


async def run(ctx: JobContext, job: Job) -> None:
    """Cut every piece of the parent's split the server holds, then finish the split if it can.

    Each piece commits on its own, so a failure keeps the pieces already cut. The
    parent's full original stays until every piece has its slice, and is deleted only
    after the commit that stops naming it. A soft-deleted parent's pieces are still cut,
    and its split is marked completed so the purge sweep may delete it.
    """
    async with ctx.sessionmaker() as session:
        prepared = await _prepare(session, job)
        if prepared is None:
            return
        parent, stored_job = prepared
        # Files a step named on a row whose commit had not landed yet, with that row's id.
        pending: Orphans | None = None
        superseded: str | None = None
        completed = False
        orphans: list[str] = []
        with ctx.work_dir() as folder:
            files = ParentFiles(ctx.store, Path(folder))
            try:
                async with attempt_timeout():
                    if parent.original_key is None:
                        await back_up_parent(session, ctx.store, parent)
                        await session.commit()
                    while (piece := await _next_waiting(session, parent)) is not None:
                        await cut_piece(session, files, parent, piece)
                        pending = Orphans(
                            (piece.original_key, piece.playback_key, piece.peaks_key), piece.id
                        )
                        await session.commit()
                        pending = None
                    if await _ready_to_complete(session, parent):
                        # A deleted parent's whole prefix goes to the purge sweep.
                        if parent.deleted_at is None:
                            orphans = await list_unnamed_originals(ctx.store, parent)
                        superseded = await complete_split(session, files, parent)
                        completed = parent.split_completed_id == parent.split_id
                        if superseded is not None:
                            pending = Orphans((parent.original_key,), parent.id)
                    await _end(session, parent, stored_job)
                    await session.commit()
            except asyncio.CancelledError:
                await release_cancelled(ctx, session, job, pending)
                raise
            except Exception as exc:  # noqa: BLE001 -- any split failure is a job failure, not a crash
                # On the last attempt every waiting piece fails. The parent keeps its full
                # original and its files, so no audio is lost.
                await recover_failed_audio_rewrite(
                    ctx,
                    session,
                    job,
                    exc,
                    orphaned=pending or Orphans(),
                    release_backup=True,
                    on_final_failure=_fail_waiting,
                )
                return
    await delete_best_effort(
        ctx.store,
        [superseded],
        log=log,
        message="could not delete a split parent's full original",
    )
    if completed:
        await delete_best_effort(
            ctx.store,
            [key for key in orphans if key != parent.original_key],
            log=log,
            message="could not delete an unnamed original slice",
        )


async def _prepare(session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
    """Load the row pair for a split job, keeping a soft-deleted parent.

    Returns:
        tuple[Recording, Job] | None: The loaded pair, or None when the parent is gone,
        has no split or no ready files to cut from, or another claimer has since
        re-locked the job past our own claim.
    """
    async with session.begin():
        loaded = await load_parent(session, job)
        if loaded is None:
            return None
        parent, stored_job = loaded
        # The parent's transcode queues a new split job once it is ready.
        if parent.state != "ready" or parent.split_id is None:
            await session.delete(stored_job)
            return None
        return loaded


async def _next_waiting(session: AsyncSession, parent: Recording) -> Recording | None:
    """Read the next live piece split from the parent still waiting for its cut.

    Re-read each time, so a piece pushed or deleted while an earlier one was cut is seen.
    A piece of an earlier split counts too: the parent's original still covers it until
    the latest split completes, and the push refuses that split's pieces once a new
    split replaced it, so none can arrive after.
    """
    async with session.begin():
        await session.refresh(
            parent,
            attribute_names=["split_id", "split_size", "split_completed_id", "deleted_at"],
        )
        return await session.scalar(
            select(Recording)
            .where(waiting_pieces(parent.id))
            .order_by(Recording.id)
            .limit(1)
            .execution_options(populate_existing=True)
        )


async def _ready_to_complete(session: AsyncSession, parent: Recording) -> bool:
    """Whether every piece of the parent's split is cut and the split is not yet recorded.

    Re-reads the parent's trim and original, so the completion slice is cut from them as
    they are now.
    """
    async with session.begin():
        await session.refresh(
            parent,
            attribute_names=[
                "trim_start_ms",
                "trim_end_ms",
                "split_id",
                "split_size",
                "split_completed_id",
                "original_key",
                "source_offset_ms",
                "source_duration_ms",
                "deleted_at",
            ],
        )
        return await split_ready_to_complete(session, parent)


async def _end(session: AsyncSession, parent: Recording, stored_job: Job) -> None:
    """Delete the job and queue whatever the parent needs next, under the user's lock."""
    await lock_user(session, parent.user_id)
    await session.delete(stored_job)
    # A piece pushed after the last query found this job holding the one split slot.
    await ensure_split_job(session, parent)
    await ensure_trim_job(session, parent)


async def _fail_waiting(session: AsyncSession, parent: Recording) -> None:
    await fail_waiting_pieces(session, parent.id, SPLIT_FAILED)


async def abandon(ctx: JobContext, session: AsyncSession, job: Job) -> None:
    """Fail the waiting pieces of a split whose attempts all ended without an outcome."""
    parent = await release_backup_copy(ctx, session, job)
    if parent is not None:
        failed = await fail_waiting_pieces(session, parent.id, SPLIT_FAILED)
        log.error(
            "split gave up after attempts that never finished",
            extra={"recording": str(parent.id), "failed_pieces": failed},
        )
