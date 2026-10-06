"""The rules a push applies to one table's rows around the generic upsert."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any, ClassVar

from sqlalchemy import func, select

from crosstune.db.base import next_server_seq
from crosstune.links.detect import detect_provider, normalize_url, valid_slippery_hill_ref
from crosstune.links.resolve import unresolved_link
from crosstune.models import Recording, RecordingLoop, Scan, StatusChange, UserTune
from crosstune.recordings.loops import (
    clamp_loop,
    clamp_span,
    largest_free_stretch,
    loop_bounds,
    reclamp_recording_loops,
)
from crosstune.recordings.service import ensure_trim_job, start_import
from crosstune.recordings.trim import clamp_trim
from crosstune.vocabulary import (
    MAX_LOOPS_PER_RECORDING,
    MAX_SCANS_PER_TUNE,
    MIN_LOOP_MS,
    RecordingSource,
    TableName,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import InstrumentedAttribute

    from crosstune.links.resolve import ResolvedLink
    from crosstune.schemas.common import Change


class RowRules:
    """Hooks a table adds around the generic upsert of one pushed row. The base adds none.

    One instance serves one change, so state a hook reads before the write, such as the
    stored row, is still there for a hook after it.
    """

    # Whether a batch applies this table's deletes first and holds back each upsert that
    # `overlaps` reports, so a row never loses room another change in the batch frees.
    defers_overlaps: ClassVar[bool] = False

    def __init__(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        change: Change,
        resolved_links: Mapping[str, ResolvedLink] | None,
    ) -> None:
        self.session = session
        self.user_id = user_id
        self.change = change
        self.resolved_links = resolved_links

    async def overlaps(self, data: dict[str, Any]) -> bool:  # noqa: ARG002 -- a hook the subclasses fill in
        """Whether the row's span, before any clamp, overlaps another live row's.

        Read only when `defers_overlaps` is set.
        """
        return False

    async def prepare(self, data: dict[str, Any]) -> str | None:  # noqa: ARG002 -- a hook the subclasses fill in
        """Rewrite the validated fields in place before the write.

        Returns:
            str | None: Why the change is refused, or None to write it.
        """
        return None

    async def live_siblings(
        self, parent_column: InstrumentedAttribute[uuid.UUID], parent_id: uuid.UUID
    ) -> int:
        """How many of the user's live rows share this parent, not counting this change's row.

        The count behind every per-parent cap, such as loops per recording.
        """
        # The table varies with the caller, so its columns aren't statically known here.
        model: Any = parent_column.class_
        live = await self.session.scalar(
            select(func.count())
            .select_from(model)
            .where(
                parent_column == parent_id,
                model.user_id == self.user_id,
                model.deleted_at.is_(None),
                model.id != self.change.id,
            )
        )
        return live or 0

    async def written(self, row: Any) -> None:  # noqa: ARG002 -- the row's model varies by table
        """Act on the row the upsert wrote, before the result is read."""
        return

    async def applied(self, row: Any) -> None:  # noqa: ARG002 -- the row's model varies by table
        """Act on the row in place after a change that applied, written now or before."""
        return


class RecordingLinkRules(RowRules):
    """Store a pushed link in the shape the online paste path stores."""

    async def prepare(self, data: dict[str, Any]) -> str | None:
        """Rewrite the link's url, provider, ref, title, and artwork in place."""
        if self.resolved_links is not None and data.get("title") is None:
            resolved = self.resolved_links.get(data["url"]) or unresolved_link(data["url"])
            # Store what the online paste path would have stored: the canonical url and the
            # provider the resolver identified, not the raw string the client happened to hold.
            data["url"] = resolved.url
            data["provider"] = resolved.provider
            data["provider_ref"] = resolved.provider_ref or data.get("provider_ref")
            data["title"] = resolved.title
            data["artwork_url"] = data.get("artwork_url") or resolved.artwork_url

        if data["provider"] == "other":
            # A client that predates a provider saves its links as other, and a titled link
            # is never resolved, so detect it here, without a fetch.
            provider, ref = detect_provider(data["url"])
            if provider != "other":
                data["url"] = normalize_url(data["url"], provider, ref)
                data["provider"] = provider
                data["provider_ref"] = ref

        # A client-sent ref is appended to the site origin, so only a valid one is kept.
        if data["provider"] == "slippery_hill" and not valid_slippery_hill_ref(
            data.get("provider_ref") or ""
        ):
            data["provider_ref"] = None
        return None


class RecordingRules(RowRules):
    """Keep a pushed trim inside the playback file, and start the work a write calls for."""

    stored: Recording | None = None

    async def prepare(self, data: dict[str, Any]) -> str | None:
        """Keep a pushed trim inside the stored row's playback range, in place.

        Uses the row already in the database rather than the pushed values, so a stale
        push, which the upsert's timestamp check rejects, never has its rewritten trim
        mistaken for what was actually written.
        """
        self.stored = await self.session.get(Recording, self.change.id)
        low = (self.stored.playback_start_ms or 0) if self.stored else 0
        high = self.stored.playback_end_ms if self.stored else None
        source_end = self.stored.source_duration_ms if self.stored else None
        end = data["trim_end_ms"]
        # A null end means the source end, which a playback file cut short no longer
        # reaches, so it is clamped as that end and only stays null where it still fits.
        if end is None and source_end is not None:
            end = source_end
        start, end = clamp_trim(data["trim_start_ms"], end, low=low, high=high)
        if data["trim_end_ms"] is None and end == source_end:
            end = None
        data["trim_start_ms"], data["trim_end_ms"] = start, end
        return None

    async def applied(self, row: Recording) -> None:
        """Queue a trim, re-clamp the loops, and start an import the push created."""
        # Queued from the row as committed by the upsert, in the same transaction as the push.
        await ensure_trim_job(self.session, row)
        await reclamp_recording_loops(self.session, row, self.change.updated_at)
        # Only a row this push created starts an import, so an update never queues a second
        # fetch and an existing recording can't be turned into one.
        if self.stored is None and row.source == RecordingSource.IMPORT:
            await start_import(self.session, row)
            # The result is serialized from this row, and server_seq is still a SQL expression.
            await self.session.flush()
            await self.session.refresh(row)


class RecordingLoopRules(RowRules):
    """Keep a pushed loop inside its recording's trim, off its other loops, and under the cap."""

    defers_overlaps = True

    async def overlaps(self, data: dict[str, Any]) -> bool:
        """Whether the loop's span, before any clamp, overlaps another of the user's live loops."""
        hit = await self.session.scalar(
            select(RecordingLoop.id)
            .where(
                RecordingLoop.recording_id == data["recording_id"],
                RecordingLoop.user_id == self.user_id,
                RecordingLoop.deleted_at.is_(None),
                RecordingLoop.id != self.change.id,
                RecordingLoop.start_ms < data["end_ms"],
                RecordingLoop.end_ms > data["start_ms"],
            )
            .limit(1)
        )
        return hit is not None

    async def prepare(self, data: dict[str, Any]) -> str | None:
        """Clamp the loop and enforce the cap in place.

        A loop that no longer fits gets `deleted_at` set in `data`, so it is stored deleted.
        """
        if not await self._clamp(data):
            data["deleted_at"] = self.change.updated_at
            return None
        if not await self._write_keeps_live_count(data["recording_id"]) and (
            await self.live_siblings(RecordingLoop.recording_id, data["recording_id"])
            >= MAX_LOOPS_PER_RECORDING
        ):
            return "loop limit reached"
        return None

    async def _clamp(self, data: dict[str, Any]) -> bool:
        """Keep the loop inside its recording's trim and off its other live loops, in place.

        Returns:
            bool: True when the loop fits, in which case `data` holds the longest stretch of
                the clamped span that no other live loop takes. False when too little of the
                loop remains or its recording is deleted, in which case `data` holds the
                clamped span and the loop must be stored deleted.
        """
        recording = await self.session.get(Recording, data["recording_id"])
        if recording is None:
            return True
        if recording.deleted_at is not None:
            return False
        low, high = loop_bounds(recording)
        fits = clamp_loop(data["start_ms"], data["end_ms"], low=low, high=high) is not None
        data["start_ms"], data["end_ms"] = clamp_span(
            data["start_ms"], data["end_ms"], low=low, high=high
        )
        if not fits:
            return False
        taken = await self.session.execute(
            select(RecordingLoop.start_ms, RecordingLoop.end_ms).where(
                RecordingLoop.recording_id == data["recording_id"],
                RecordingLoop.user_id == self.user_id,
                RecordingLoop.deleted_at.is_(None),
                RecordingLoop.id != self.change.id,
            )
        )
        free = largest_free_stretch(
            data["start_ms"], data["end_ms"], [(start, end) for start, end in taken]
        )
        if free is None or free[1] - free[0] < MIN_LOOP_MS:
            return False
        data["start_ms"], data["end_ms"] = free
        return True

    async def _write_keeps_live_count(self, recording_id: uuid.UUID) -> bool:
        """Whether this write cannot add a live loop to `recording_id`, so the cap does not apply.

        True when the stored loop's timestamp is not older than the change, so last-write-wins
        writes nothing, or when the stored loop is already live on that recording.
        """
        stored = await self.session.get(RecordingLoop, self.change.id)
        if stored is None or stored.user_id != self.user_id:
            return False
        if stored.updated_at >= self.change.updated_at:
            return True
        return stored.deleted_at is None and stored.recording_id == recording_id


class ScanRules(RowRules):
    """Keep a scan on the tune it was made for, and under the tune's scan limit."""

    async def prepare(self, data: dict[str, Any]) -> str | None:
        """Refuse a scan that would move to another tune or exceed the tune's scan limit."""
        stored = await self.session.get(Scan, self.change.id)
        if stored is not None and stored.user_id == self.user_id:
            if stored.tune_id != data["tune_id"]:
                return "tune_id is fixed"
            if stored.updated_at >= self.change.updated_at or stored.deleted_at is None:
                return None
        if await self.live_siblings(Scan.tune_id, data["tune_id"]) >= MAX_SCANS_PER_TUNE:
            return "scan limit reached"
        return None


class UserTuneRules(RowRules):
    """Record each change of a user tune's status in its history."""

    prior_status: str | None = None

    async def prepare(self, data: dict[str, Any]) -> str | None:  # noqa: ARG002 -- the hook's signature
        """Read the status stored before the write, for the history row."""
        # A scalar read, never an instance: the upsert's populate_existing would overwrite it.
        self.prior_status = await self.session.scalar(
            select(UserTune.status).where(
                UserTune.id == self.change.id, UserTune.user_id == self.user_id
            )
        )
        return None

    async def written(self, row: UserTune) -> None:
        """Add a history row when the written user tune holds a different status than before."""
        if row.status == self.prior_status:
            return
        self.session.add(
            StatusChange(
                id=uuid.uuid4(),
                user_id=self.user_id,
                user_tune_id=self.change.id,
                from_status=self.prior_status,
                to_status=row.status,
                changed_at=self.change.updated_at,
                server_seq=next_server_seq(),
            )
        )


RULES: dict[TableName, type[RowRules]] = {
    "recording_links": RecordingLinkRules,
    "recordings": RecordingRules,
    "recording_loops": RecordingLoopRules,
    "scans": ScanRules,
    "user_tunes": UserTuneRules,
}
"""The tables with rules of their own. Every other table uses RowRules, which adds none."""
