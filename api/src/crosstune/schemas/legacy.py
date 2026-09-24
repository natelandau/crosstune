"""The sync wire's first names, which call a tune a song.

An install that predates tunes pushes and pulls in these names. A pushed change is read in
either names, and a response answers in song names unless the request asks for tune names.
"""

from __future__ import annotations

from typing import Any, Literal

Names = Literal["songs", "tunes"]

TABLES_FROM_SONG_NAMES = {"songs": "tunes", "user_songs": "user_tunes"}
FIELDS_FROM_SONG_NAMES = {"song_id": "tune_id", "user_song_id": "user_tune_id"}
TABLES_TO_SONG_NAMES = {new: old for old, new in TABLES_FROM_SONG_NAMES.items()}
FIELDS_TO_SONG_NAMES = {new: old for old, new in FIELDS_FROM_SONG_NAMES.items()}


def _renamed(values: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    return {names.get(key, key): value for key, value in values.items()}


def current_change(value: Any) -> Any:
    """A raw pushed change with its table and data keys in tune names.

    Args:
        value: The change as the request carried it, before validation.

    Returns:
        Any: The change in tune names, or the value untouched when it is not a mapping.
    """
    if not isinstance(value, dict):
        return value
    change = dict(value)
    table = change.get("table")
    if isinstance(table, str):
        change["table"] = TABLES_FROM_SONG_NAMES.get(table, table)
    data = change.get("data")
    if isinstance(data, dict):
        change["data"] = _renamed(data, FIELDS_FROM_SONG_NAMES)
    return change


def song_names(entry: dict[str, Any]) -> dict[str, Any]:
    """A serialized change result or pull row in song names.

    Args:
        entry: One result or pull row, as JSON-ready data.

    Returns:
        dict[str, Any]: A copy with its table and row keys in song names.
    """
    renamed = {**entry, "table": TABLES_TO_SONG_NAMES.get(entry["table"], entry["table"])}
    row = entry.get("row")
    if isinstance(row, dict):
        renamed["row"] = _renamed(row, FIELDS_TO_SONG_NAMES)
    return renamed
