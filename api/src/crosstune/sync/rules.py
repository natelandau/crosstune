"""The rules a push applies to one table's rows around the generic upsert."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar

from sqlalchemy import func, select

from crosstune.db.base import bump_server_seq, next_server_seq
from crosstune.files.quota import OVER_QUOTA, revive_exceeds_quota
from crosstune.links.detect import detect_provider, normalize_url, valid_slippery_hill_ref
from crosstune.links.resolve import unresolved_link
from crosstune.models import (
    Place,
    Recording,
    RecordingLoop,
    Scan,
    StatusChange,
    User,
    UserSettings,
    UserTune,
)
from crosstune.places.matching import (
    MATCH_RADIUS_M,
    Area,
    distance_m,
    link_earlier_recordings,
    matching_place_id,
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
from crosstune.recordings.split_rules import (
    latest_split_pieces,
    split_first_cut,
    unfinished_pieces,
)
from crosstune.recordings.trim_rules import clamp_trim, original_range
from crosstune.vocabulary import (
    MAX_LOOPS_PER_RECORDING,
    MAX_SCANS_PER_TUNE,
    MAX_SPLIT_PIECES,
    MIN_LOOP_MS,
    PREMIUM_REQUIRED,
    SPLIT_FULL,
    SPLIT_MISMATCH,
    SPLIT_UNNAMED,
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

    @classmethod
    async def settle(cls, session: AsyncSession, user_id: uuid.UUID) -> None:  # noqa: ARG003 -- a hook the subclasses fill in
        """Finish work the table's changes in one push queued, once all of them have applied."""
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


# Where a push's place rules gather the areas its changes touched, until the places group ends.
_PLACE_AREAS = "crosstune.place_areas"


@dataclass(repr=False)
class _PlaceAreas:
    # Each place a change created or moved, read for its final state once the group ends.
    placed: dict[uuid.UUID, Place] = field(default_factory=dict)
    vacated: list[Area] = field(default_factory=list)


class PlaceRules(RowRules):
    """Link earlier recordings to a created or moved place, and unlink them from a deleted one.

    Linking waits until every place change in the push has applied, then runs once for all of
    them, so its cost grows with the push and not with how many places stand close together.
    """

    # The stored point as it was before the upsert, which refreshes the stored row in place.
    stored_point: tuple[float, float] | None = None

    def _areas(self) -> _PlaceAreas:
        return self.session.info.setdefault(_PLACE_AREAS, _PlaceAreas())

    async def prepare(self, data: dict[str, Any]) -> str | None:  # noqa: ARG002 -- the hook's signature
        """Remember the stored point to tell a move from a replay."""
        stored = await self.session.get(Place, self.change.id)
        if stored is not None and stored.user_id == self.user_id:
            self.stored_point = (stored.lat, stored.lon)
        return None

    async def applied(self, row: Place) -> None:
        """Queue a new or moved place, and the point it left, for linking.

        Runs for a replayed or stale push too, which leaves the point as it was and so
        links nothing a second time.
        """
        if row.deleted_at is None and self.stored_point != (row.lat, row.lon):
            areas = self._areas()
            areas.placed[row.id] = row
            # Moving away can leave a neighbor of the old point as some recording's only match.
            if self.stored_point is not None:
                lat, lon = self.stored_point
                areas.vacated.append(Area(lat=lat, lon=lon))

    # The point of a place this delete removes, read before the delete scrubs it.
    deleted_point: tuple[float, float] | None = None

    async def deleting(self, row: Place) -> None:
        """Remember the point the delete is about to scrub."""
        self.deleted_point = (row.lat, row.lon)

    async def deleted(self, row: Place) -> None:
        """Unlink the recordings filed under a deleted place, then queue its point for linking.

        The unlinked recordings keep their own names. A recording that matched both this place
        and a neighbor matched neither, so each live place near the deleted one may now match it.
        """
        await unlink_place(self.session, user_id=self.user_id, place_id=row.id)
        if self.deleted_point is not None:
            lat, lon = self.deleted_point
            self._areas().vacated.append(Area(lat=lat, lon=lon))

    @classmethod
    async def settle(cls, session: AsyncSession, user_id: uuid.UUID) -> None:
        """Link earlier recordings around every point the push's place changes touched."""
        areas: _PlaceAreas | None = session.info.pop(_PLACE_AREAS, None)
        if areas is None:
            return
        await link_earlier_recordings(
            session,
            user_id=user_id,
            areas=[
                Area(lat=row.lat, lon=row.lon, place_id=row.id)
                for row in areas.placed.values()
                if row.deleted_at is None
            ]
            + areas.vacated,
        )


# Splitting is Premium, and a split's size raises the recording's upload and duration caps.
_PREMIUM_RECORDING_COLUMNS = ("trim_start_ms", "trim_end_ms", "split_id", "split_size")


def _keep_premium_edits(data: dict[str, Any], stored: Recording) -> None:
    """Replace a free plan's pushed trim and split with the stored ones, in place."""
    for column in _PREMIUM_RECORDING_COLUMNS:
        data[column] = getattr(stored, column)


class RecordingRules(RowRules):
    """Hold a free plan's trims, keep a trim inside the playback file, and start work."""

    stored: Recording | None = None
    # The recording a piece this push creates was split from.
    parent: Recording | None = None
    # The stored place as it was before the upsert, which refreshes `stored` in place.
    stored_place: tuple[float | None, float | None, str | None] | None = None

    async def prepare(self, data: dict[str, Any]) -> str | None:
        """Refuse a free plan's new recording or an over-quota revive, then settle the pushed trim.

        A free plan keeps the stored trim and split: a pushed value that differs is replaced
        with the stored one, and the rest of the change still applies. A server job can
        rewrite the stored trim without touching `updated_at`, so a device's edit may carry
        an older trim, and an edit is never refused for it. Otherwise the trim is clamped
        to the stored row's playback range. Uses the row already in the database rather
        than the pushed values, so a stale push, which the upsert's timestamp check
        rejects, never has its rewritten trim mistaken for what was actually written.
        """
        self.stored = await self._owned(self.change.id)
        if self.stored is not None:
            self.stored_place = (
                self.stored.place_lat,
                self.stored.place_lon,
                self.stored.place_name,
            )
        if await self._revive_over_quota():
            return OVER_QUOTA
        free = not self.access.premium
        # Refused before the saved location match, so a refused change does no matching work.
        if free and self.stored is None:
            return PREMIUM_REQUIRED
        await self._settle_place(data)
        if free and self.stored is not None and self._upsert_writes(self.stored):
            _keep_premium_edits(data, self.stored)
            return None
        low = (
            max(self.stored.source_offset_ms, self.stored.playback_start_ms or 0)
            if self.stored
            else 0
        )
        high = self.stored.playback_end_ms if self.stored else None
        source_end = self.stored.source_duration_ms if self.stored else None
        if self.stored is None and data.get("split_from_id") is not None:
            parent = await self._piece_parent(data)
            if not isinstance(parent, Recording):
                return parent
            # A piece's trim is a range of the parent's source, which the parent's own
            # playback file may no longer cover.
            low, high = original_range(parent)
        end = data["trim_end_ms"]
        # A null end means the source end, which a playback file cut short no longer
        # reaches, so it is clamped as that end and only stays null where it still fits.
        if end is None and source_end is not None:
            end = source_end
        start, end = clamp_trim(data["trim_start_ms"], end, low=low, high=high)
        start, end = await self._hold_split_parent(data, start, end)
        if data["trim_end_ms"] is None and end == source_end:
            end = None
        data["trim_start_ms"], data["trim_end_ms"] = start, end
        return None

    async def _owned(self, recording_id: uuid.UUID) -> Recording | None:
        """The caller's recording with this id, or None for an unknown or foreign id."""
        recording = await self.session.get(Recording, recording_id)
        return recording if recording is not None and recording.user_id == self.user_id else None

    async def _revive_over_quota(self) -> bool:
        """Whether the upsert would revive a deleted recording past the account's quota."""
        stored = self.stored
        if stored is None or stored.deleted_at is None or not self._upsert_writes(stored):
            return False
        return await revive_exceeds_quota(self.session, stored, self.access.quota_bytes)

    async def _hold_split_parent(
        self, data: dict[str, Any], start: int, end: int | None
    ) -> tuple[int, int | None]:
        """Keep a split parent's trim inside its stored start and its split's first piece.

        A device that has not pulled the split pushes the parent's full trim, which would
        widen the parent over its pieces' audio.

        Returns:
            tuple[int, int | None]: The trim, narrowed where the push widened it.
        """
        stored = self.stored
        if stored is None or stored.split_id is None or data["split_id"] != stored.split_id:
            return start, end
        first_cut = await split_first_cut(self.session, stored)
        high = first_cut if first_cut is not None else stored.trim_end_ms
        if high is not None and (end is None or end > high):
            end = high
        return clamp_trim(start, end, low=stored.trim_start_ms, high=high)

    async def _piece_parent(self, data: dict[str, Any]) -> Recording | str | None:
        """Check a new piece against the recording it was split from.

        Returns:
            Recording | str | None: The parent recording; the reason to refuse the piece;
            or None when the parent is not one of this user's recordings, which the
            parent check refuses on its own.
        """
        created_by = data.get("created_by_split_id")
        if created_by is None:
            return SPLIT_UNNAMED
        parent = await self._owned(data["split_from_id"])
        if parent is None:
            return None
        if parent.split_id is not None and created_by != parent.split_id:
            return SPLIT_MISMATCH
        # The parent's split when it has one, which the check above makes the same.
        held, unfinished = (
            await self.session.execute(
                select(
                    func.count().filter(latest_split_pieces(parent.id, created_by)),
                    func.count().filter(unfinished_pieces(parent.id)),
                ).where(Recording.split_from_id == parent.id)
            )
        ).one()
        size = parent.split_size if parent.split_id is not None else None
        if size is not None and held >= size - 1:
            return SPLIT_FULL
        # Every piece is cut from the parent's original, so the parent's unfinished pieces,
        # of every split, are held to one split's worth. This also holds a piece that
        # arrives before its parent's split.
        if unfinished >= MAX_SPLIT_PIECES - 1:
            return SPLIT_FULL
        self.parent = parent
        return parent

    async def _settle_place(self, data: dict[str, Any]) -> None:
        """Set the pushed place link and origin in place, and link a new fix to its place.

        A client that predates saved places omits both keys, and an omitted key keeps the
        stored value rather than writing null. A 1.0.0 client may instead echo the stored
        values it kept from an earlier pull, so an origin pushed unchanged with new
        coordinates is inferred again rather than trusted. A link is stored only when it
        names a live place of this user, and a link the stored row already had survives
        new coordinates only while they stay within the match radius of the place, so a
        stale or raced link is dropped instead of refusing the recording. A device or file fix
        at new coordinates is linked to the one saved place it matches, so it shows that
        name even before, or without, an Apple Maps lookup.
        """
        # Locals stay scrubbable by name or non-sensitive: error reports keep frame locals.
        stored = self.stored
        same_point = stored is not None and (data["place_lat"], data["place_lon"]) == (
            stored.place_lat,
            stored.place_lon,
        )

        if "place_id" not in (self.change.data or {}) and stored is not None:
            data["place_id"] = stored.place_id
        _settle_repick(data, stored, same_point=same_point)
        # The server links a device or file fix without touching updated_at, so a client that has
        # not pulled that link yet pushes null for it; no client unlinks such a recording in place.
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
        """Whether the pushed `place_id` names a live place of this user the recording may link to.

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
        """Whether the upsert would write over the caller's `stored`, rather than report stale."""
        return stored.updated_at < self.change.updated_at

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
        """Queue trim and place jobs, re-clamp the loops, and start what the push created.

        The push queues split jobs once for its whole batch.
        """
        created_piece = self.stored is None and row.split_from_id is not None
        if created_piece:
            parent = self.parent
            if parent is not None and parent.state == "failed":
                # A failed parent has nothing to cut the piece from.
                row.state, row.error = "failed", parent.error
            else:
                row.state = "processing"
            bump_server_seq(row)
            # The result is serialized from this row, and server_seq is still a SQL expression.
            await self.session.flush()
            await self.session.refresh(row)
        # Queued from the row as committed by the upsert, in the same transaction as the push.
        await ensure_trim_job(self.session, row)
        if self._place_may_need_name(row):
            await ensure_place_job(self.session, row)
        await reclamp_recording_loops(self.session, row, self.change.updated_at)
        # Only a row this push created starts an import, so an update never queues a second
        # fetch and an existing recording can't be turned into one.
        if self.stored is None and row.source == RecordingSource.IMPORT:
            await start_import(self.session, row, self.access)
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
        """Refuse a scan that moves tune, passes the tune's limit or quota, or lacks Premium."""
        stored = await self.session.get(Scan, self.change.id)
        if stored is not None and stored.user_id == self.user_id:
            if stored.tune_id != data["tune_id"]:
                return "tune_id is fixed"
            if stored.updated_at >= self.change.updated_at or stored.deleted_at is None:
                return None
            if await revive_exceeds_quota(self.session, stored, self.access.quota_bytes):
                return OVER_QUOTA
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


SETTINGS_NAMESPACE = uuid.UUID("5d1c0b8a-3e7f-4a92-9c64-2b8e1f0a7d33")
"""The namespace every client derives a settings row id from. It must match the clients'."""


def settings_id(clerk_user_id: str) -> uuid.UUID:
    """The id of a Clerk user's one settings row, as every client derives it."""
    return uuid.uuid5(SETTINGS_NAMESPACE, clerk_user_id)


class UserSettingsRules(RowRules):
    """Holds a settings row to its account's derived id and keeps a stored reference pitch."""

    async def prepare(self, data: dict[str, Any]) -> str | None:
        """Refuse any id but the account's derived one, and keep a stored omitted `tuner_a4_hz`.

        The id is derivable from a public namespace and a Clerk user id, so without the check
        another account could store a row under it first and own it for good.

        A client that predates the tuner sends every other setting and no reference pitch,
        which would otherwise write the default over the one another device set.
        """
        clerk_user_id = (
            await self.session.execute(select(User.clerk_user_id).where(User.id == self.user_id))
        ).scalar_one()
        if self.change.id != settings_id(clerk_user_id):
            return "id is not this account's settings id"
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
