"""The rules a push applies to one table's rows around the generic upsert."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any, ClassVar

from sqlalchemy import func, select

from crosstune.db.base import next_server_seq
from crosstune.links.detect import detect_provider, normalize_url, valid_slippery_hill_ref
from crosstune.links.resolve import unresolved_link
from crosstune.models import (
    Place,
    Recording,
    RecordingLoop,
    Scan,
    StatusChange,
    UserSettings,
    UserTune,
)
from crosstune.places.matching import (
    MATCH_RADIUS_M,
    distance_m,
    link_earlier_takes,
    matching_place_id,
    reach_back_around,
    unlink_place,
)
from crosstune.recordings.loops import (
    clamp_loop,
    clamp_span,
    largest_free_stretch,
    loop_bounds,
    reclamp_recording_loops,
)
from crosstune.recordings.service import ensure_place_job, ensure_trim_job, start_import
from crosstune.recordings.trim_rules import clamp_trim
from crosstune.vocabulary import (
    MAX_LOOPS_PER_RECORDING,
    MAX_SCANS_PER_TUNE,
    MIN_LOOP_MS,
    PREMIUM_REQUIRED,
    PlaceOrigin,
    RecordingSource,
    TableName,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import InstrumentedAttribute

    from crosstune.billing.access import Access
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
        access: Access,
    ) -> None:
        self.session = session
        self.user_id = user_id
        self.change = change
        self.resolved_links = resolved_links
        self.access = access

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

    async def deleting(self, row: Any) -> None:  # noqa: ARG002 -- the row's model varies by table
        """Act on a live row a delete change is about to delete, before the delete writes."""
        return

    async def deleted(self, row: Any) -> None:  # noqa: ARG002 -- the row's model varies by table
        """Act on a row a delete change left deleted, written now or before."""
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


# The origins of a fix the server links to a saved place on its own.
_AUTOMATIC_ORIGINS = frozenset({PlaceOrigin.DEVICE.value, PlaceOrigin.FILE.value})


def _settle_repick(data: dict[str, Any], stored: Recording | None, *, same_point: bool) -> None:
    """Mark a 1.0.0 hand pick at the stored point as picked, and drop its echoed link.

    A 1.0.0 client drops the accuracy and sets its own name for a hand pick but echoes
    the automatic origin and link it pulled, which would leave the pick open to an
    address rename and shown under the linked place's name. A current client marks its
    own picks, and its other edits keep the name or the accuracy, so none reads as a pick.
    """
    if (
        stored is not None
        and same_point
        and stored.place_origin in _AUTOMATIC_ORIGINS
        and data["place_origin"] == stored.place_origin
        and data["place_name"] != stored.place_name
        and data["place_accuracy_m"] is None
        and stored.place_accuracy_m is not None
    ):
        data["place_origin"] = PlaceOrigin.PICKED.value
        if data["place_id"] == stored.place_id:
            data["place_id"] = None


class PlaceRules(RowRules):
    """Link earlier takes to a created or moved place, and unlink them from a deleted one."""

    # The stored point as it was before the upsert, which refreshes the stored row in place.
    stored_point: tuple[float, float] | None = None

    async def prepare(self, data: dict[str, Any]) -> str | None:  # noqa: ARG002 -- the hook's signature
        """Remember the stored point to tell a move from a replay."""
        stored = await self.session.get(Place, self.change.id)
        if stored is not None and stored.user_id == self.user_id:
            self.stored_point = (stored.lat, stored.lon)
        return None

    async def applied(self, row: Place) -> None:
        """Reach back on a new or moved place, and from the neighbors of a moved place's old point.

        Runs for a replayed or stale push too, which leaves the point as it was and so
        links nothing a second time.
        """
        if row.deleted_at is None and self.stored_point != (row.lat, row.lon):
            await link_earlier_takes(self.session, row)
            # Moving away can leave a neighbor of the old point as some take's only match.
            if self.stored_point is not None:
                lat, lon = self.stored_point
                await reach_back_around(self.session, user_id=self.user_id, lat=lat, lon=lon)

    # The point of a place this delete removes, read before the delete scrubs it.
    deleted_point: tuple[float, float] | None = None

    async def deleting(self, row: Place) -> None:
        """Remember the point the delete is about to scrub."""
        self.deleted_point = (row.lat, row.lon)

    async def deleted(self, row: Place) -> None:
        """Unlink the recordings filed under a deleted place, then reach back from its neighbors.

        The unlinked takes keep their own names. A take that matched both this place and a
        neighbor matched neither, so each live place near the deleted one reaches back again.
        """
        await unlink_place(self.session, row.id)
        if self.deleted_point is not None:
            lat, lon = self.deleted_point
            await reach_back_around(self.session, user_id=self.user_id, lat=lat, lon=lon)


class RecordingRules(RowRules):
    """Hold a free plan's trims, keep a trim inside the playback file, and start work."""

    stored: Recording | None = None
    # The stored place as it was before the upsert, which refreshes `stored` in place.
    stored_place: tuple[float | None, float | None, str | None] | None = None

    async def prepare(self, data: dict[str, Any]) -> str | None:
        """Refuse a free plan's new recording, then settle the pushed trim in place.

        A free plan keeps the stored trim: a pushed trim that differs is replaced with it,
        and the rest of the change still applies. A server job can rewrite the stored trim
        without touching `updated_at`, so a device's edit may carry an older trim, and an
        edit is never refused for it. Otherwise the trim is clamped to the stored row's
        playback range. Uses the row already in the database rather than the pushed
        values, so a stale push, which the upsert's timestamp check rejects, never has its
        rewritten trim mistaken for what was actually written.
        """
        self.stored = await self.session.get(Recording, self.change.id)
        if self.stored is not None:
            self.stored_place = (
                self.stored.place_lat,
                self.stored.place_lon,
                self.stored.place_name,
            )
        await self._settle_place(data)
        if not self.access.premium:
            if self.stored is None:
                return PREMIUM_REQUIRED
            if self._upsert_writes(self.stored):
                data["trim_start_ms"] = self.stored.trim_start_ms
                data["trim_end_ms"] = self.stored.trim_end_ms
                return None
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

    async def _settle_place(self, data: dict[str, Any]) -> None:
        """Set the pushed place link and origin in place, and link a new fix to its place.

        A client that predates saved places omits both keys, and an omitted key keeps the
        stored value rather than writing null. A 1.0.0 client may instead echo the stored
        values it kept from an earlier pull, so an origin pushed unchanged with new
        coordinates is inferred again rather than trusted. A link is stored only when it
        names a live place of this user, and a link the stored row already had survives
        new coordinates only while they stay within the match radius of the place, so a
        stale or raced link is dropped instead of refusing the take. A device or file fix
        at new coordinates is linked to the one saved place it matches, so it shows that
        name even before, or without, an Apple Maps lookup.
        """
        # Locals stay scrubbable by name or non-sensitive: error reports keep frame locals.
        stored = self.stored if self.stored and self.stored.user_id == self.user_id else None
        same_point = stored is not None and (data["place_lat"], data["place_lon"]) == (
            stored.place_lat,
            stored.place_lon,
        )

        if "place_id" not in (self.change.data or {}) and stored is not None:
            data["place_id"] = stored.place_id
        _settle_repick(data, stored, same_point=same_point)
        # The server links a device or file fix without touching updated_at, so a client that
        # has not pulled that link yet pushes null for it; no client unlinks such a take in place.
        if (
            data["place_id"] is None
            and stored is not None
            and same_point
            and stored.place_id is not None
            and data["place_origin"] in _AUTOMATIC_ORIGINS
        ):
            data["place_id"] = stored.place_id
        if data["place_lat"] is None or data["place_lon"] is None:
            data["place_id"] = None
            data["place_origin"] = None
            return

        if data["place_id"] is not None and not await self._keeps_link(
            data, stored, same_point=same_point
        ):
            data["place_id"] = None

        echoed = (
            stored is not None and not same_point and data["place_origin"] == stored.place_origin
        )
        if data["place_origin"] is None or echoed:
            if data["place_accuracy_m"] is not None:
                data["place_origin"] = PlaceOrigin.DEVICE.value
            elif same_point and stored.place_origin is not None:
                data["place_origin"] = stored.place_origin
            elif data["place_name"] is None and data.get("source") == RecordingSource.UPLOAD.value:
                data["place_origin"] = PlaceOrigin.FILE.value
            else:
                data["place_origin"] = PlaceOrigin.PICKED.value

        if (
            data["place_id"] is None
            and not same_point
            and data["place_origin"] in _AUTOMATIC_ORIGINS
        ):
            data["place_id"] = await matching_place_id(
                self.session,
                user_id=self.user_id,
                lat=data["place_lat"],
                lon=data["place_lon"],
                accuracy_m=data["place_accuracy_m"],
            )

    async def _keeps_link(
        self, data: dict[str, Any], stored: Recording | None, *, same_point: bool
    ) -> bool:
        """Whether the pushed `place_id` names a live place of this user the take may link to.

        A link the stored row already had, pushed again with new coordinates, is the stale
        echo of a client that predates saved places, unless the new point still lies within
        the match radius of the place, as a search pick of that same place does.
        """
        place = await self.session.scalar(
            select(Place).where(
                Place.id == data["place_id"],
                Place.user_id == self.user_id,
                Place.deleted_at.is_(None),
            )
        )
        if place is None:
            return False
        if stored is None or same_point or data["place_id"] != stored.place_id:
            return True
        return (
            distance_m(data["place_lat"], data["place_lon"], place.lat, place.lon) <= MATCH_RADIUS_M
        )

    def _upsert_writes(self, stored: Recording) -> bool:
        """Whether the upsert would write over `stored`, rather than report stale or not yours."""
        return stored.user_id == self.user_id and stored.updated_at < self.change.updated_at

    def _place_may_need_name(self, row: Recording) -> bool:
        """Whether this push could have left the row with coordinates to name.

        `applied` also runs for a replayed or stale push, which must not spend another
        lookup on coordinates whose lookup already ran or is pending.
        """
        if self.stored_place is None:
            return True
        lat, lon, name = self.stored_place
        cleared_name = name is not None and row.place_name is None
        return (row.place_lat, row.place_lon) != (lat, lon) or cleared_name

    async def applied(self, row: Recording) -> None:
        """Queue trim and place jobs, re-clamp the loops, and start an import the push created."""
        # Queued from the row as committed by the upsert, in the same transaction as the push.
        await ensure_trim_job(self.session, row)
        if self._place_may_need_name(row):
            await ensure_place_job(self.session, row)
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
    """Keep a scan on its tune and under the tune's limit, and refuse a free plan's new scan."""

    async def prepare(self, data: dict[str, Any]) -> str | None:
        """Refuse a scan that moves tune, passes the tune's limit, or is added without Premium."""
        stored = await self.session.get(Scan, self.change.id)
        if stored is not None and stored.user_id == self.user_id:
            if stored.tune_id != data["tune_id"]:
                return "tune_id is fixed"
            if stored.updated_at >= self.change.updated_at or stored.deleted_at is None:
                return None
        if not self.access.premium:
            return PREMIUM_REQUIRED
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


class UserSettingsRules(RowRules):
    """Keeps a stored reference pitch that a push leaves out."""

    async def prepare(self, data: dict[str, Any]) -> str | None:
        """Keep the stored `tuner_a4_hz` when the change omits it.

        A client that predates the tuner sends every other setting and no reference pitch,
        which would otherwise write the default over the one another device set.
        """
        if "tuner_a4_hz" in (self.change.data or {}):
            return None
        stored = await self.session.scalar(
            select(UserSettings.tuner_a4_hz).where(
                UserSettings.id == self.change.id, UserSettings.user_id == self.user_id
            )
        )
        if stored is not None:
            data["tuner_a4_hz"] = stored
        return None


RULES: dict[TableName, type[RowRules]] = {
    "recording_links": RecordingLinkRules,
    "places": PlaceRules,
    "recordings": RecordingRules,
    "recording_loops": RecordingLoopRules,
    "scans": ScanRules,
    "user_tunes": UserTuneRules,
    "user_settings": UserSettingsRules,
}
"""The tables with rules of their own. Every other table uses RowRules, which adds none."""
