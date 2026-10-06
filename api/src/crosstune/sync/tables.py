"""What the sync engine knows about each table."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import object_mapper

from crosstune.models import (
    List,
    ListItem,
    PlayEvent,
    PracticeSession,
    Recording,
    RecordingLink,
    RecordingLoop,
    Scan,
    ScanView,
    Tune,
    UserSettings,
    UserTune,
)
from crosstune.schemas.rows import (
    DATA_SCHEMAS,
    ROW_SCHEMAS,
    ListData,
    ListItemData,
    ListItemRow,
    ListRow,
    PlayEventData,
    PlayEventRow,
    PracticeSessionData,
    PracticeSessionRow,
    RecordingData,
    RecordingLinkData,
    RecordingLinkRow,
    RecordingLoopData,
    RecordingLoopRow,
    RecordingRow,
    ScanData,
    ScanRow,
    ScanViewData,
    ScanViewRow,
    TuneData,
    TuneRow,
    UserSettingsData,
    UserSettingsRow,
    UserTuneData,
    UserTuneRow,
)

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from pydantic import BaseModel
    from sqlalchemy import ColumnElement

    from crosstune.db.base import Base
    from crosstune.vocabulary import TableName


class SyncedRow(Protocol):
    """What the sync engine reads on a stored row of any synced table."""

    id: uuid.UUID
    updated_at: datetime
    deleted_at: datetime | None
    server_seq: int


@dataclass(frozen=True)
class TableSpec:
    """One synced table.

    owner_column names the column that must equal the calling user, or is None for a table
    owned through a parent.
    parents lists (foreign key column, parent table) pairs whose target must be owned by the caller.
    insert_only names client fields a push writes when it creates the row and never changes after.
    accepts_deleted_parents lets a soft-deleted parent count as owned, for rows a device can
    write after another device deleted the parent.
    append_only marks an event table: a row is written once and never edited or deleted.
    pulled is False for a table the main pull leaves out.
    children lists (child table, foreign key column on the child) pairs a delete of this
    table's row soft-deletes in turn, grandchildren included.
    owns_files marks a table whose rows name bucket files, which only the runner's purge
    removes once a row is deleted.
    """

    name: TableName
    model: type[Base]
    data_schema: type[BaseModel]
    row_schema: type[BaseModel]
    owner_column: str | None
    parents: tuple[tuple[str, TableName], ...]
    insert_only: frozenset[str] = frozenset()
    accepts_deleted_parents: bool = False
    append_only: bool = False
    pulled: bool = True
    children: tuple[tuple[TableName, str], ...] = ()
    owns_files: bool = False

    def owned_by(self, user_id: uuid.UUID) -> ColumnElement[bool]:
        """A filter matching the stored rows of this table that `user_id` owns."""
        # The model varies by table, so its columns aren't statically known here.
        model: Any = self.model
        if self.owner_column is not None:
            return getattr(model, self.owner_column) == user_id
        # list_items carry no owner; scope through the owning list.
        return model.list_id.in_(select(List.id).where(List.user_id == user_id))


# Parents before children, so a batch that creates a tune and its links applies in one pass.
TABLE_ORDER: tuple[TableName, ...] = (
    "tunes",
    "user_tunes",
    "lists",
    "list_items",
    "recording_links",
    "recordings",
    "scans",
    "recording_loops",
    "play_events",
    "practice_sessions",
    "scan_views",
    "user_settings",
)

TABLES: dict[TableName, TableSpec] = {
    "tunes": TableSpec(
        "tunes",
        Tune,
        TuneData,
        TuneRow,
        "owner_user_id",
        (),
        children=(
            ("user_tunes", "tune_id"),
            ("recording_links", "tune_id"),
            ("recordings", "tune_id"),
            ("scans", "tune_id"),
        ),
    ),
    "user_tunes": TableSpec(
        "user_tunes",
        UserTune,
        UserTuneData,
        UserTuneRow,
        "user_id",
        (("tune_id", "tunes"),),
        children=(("list_items", "user_tune_id"),),
    ),
    "lists": TableSpec(
        "lists", List, ListData, ListRow, "user_id", (), children=(("list_items", "list_id"),)
    ),
    "list_items": TableSpec(
        "list_items",
        ListItem,
        ListItemData,
        ListItemRow,
        None,  # ownership is proven through both parents
        (("list_id", "lists"), ("user_tune_id", "user_tunes")),
    ),
    "recording_links": TableSpec(
        "recording_links",
        RecordingLink,
        RecordingLinkData,
        RecordingLinkRow,
        "added_by_user_id",
        (("tune_id", "tunes"),),
    ),
    "recordings": TableSpec(
        "recordings",
        Recording,
        RecordingData,
        RecordingRow,
        "user_id",
        (("tune_id", "tunes"),),
        # Provenance decides whether the server fetches the file, so it is fixed at creation,
        # as is the date the recording was added.
        insert_only=frozenset({"source", "origin", "origin_url", "added_at"}),
        children=(("recording_loops", "recording_id"),),
        owns_files=True,
    ),
    "scans": TableSpec(
        "scans",
        Scan,
        ScanData,
        ScanRow,
        "user_id",
        (("tune_id", "tunes"),),
        owns_files=True,
    ),
    "recording_loops": TableSpec(
        "recording_loops",
        RecordingLoop,
        RecordingLoopData,
        RecordingLoopRow,
        "user_id",
        (("recording_id", "recordings"),),
        accepts_deleted_parents=True,
    ),
    "user_settings": TableSpec(
        "user_settings", UserSettings, UserSettingsData, UserSettingsRow, "user_id", ()
    ),
    "play_events": TableSpec(
        "play_events",
        PlayEvent,
        PlayEventData,
        PlayEventRow,
        "user_id",
        (
            ("tune_id", "tunes"),
            ("recording_id", "recordings"),
            ("link_id", "recording_links"),
            ("list_id", "lists"),
        ),
        accepts_deleted_parents=True,
        append_only=True,
        pulled=False,
    ),
    "practice_sessions": TableSpec(
        "practice_sessions",
        PracticeSession,
        PracticeSessionData,
        PracticeSessionRow,
        "user_id",
        (("recording_id", "recordings"), ("tune_id", "tunes")),
        accepts_deleted_parents=True,
        append_only=True,
        pulled=False,
    ),
    "scan_views": TableSpec(
        "scan_views",
        ScanView,
        ScanViewData,
        ScanViewRow,
        "user_id",
        (("tune_id", "tunes"), ("list_id", "lists")),
        accepts_deleted_parents=True,
        append_only=True,
        pulled=False,
    ),
}

assert set(TABLES) == set(DATA_SCHEMAS) == set(ROW_SCHEMAS)  # noqa: S101


def row_to_dict(obj: object) -> dict[str, Any]:
    """Every mapped column of an ORM row, ready for jsonable_encoder."""
    return {attr.key: getattr(obj, attr.key) for attr in object_mapper(obj).column_attrs}
