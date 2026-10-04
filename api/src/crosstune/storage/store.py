"""What the API and the job runner need from object storage, and how keys are laid out."""

from __future__ import annotations

import asyncio
import secrets
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import logging
    from collections.abc import Callable, Iterable
    from datetime import datetime
    from pathlib import Path

PLAYBACK_MIME = "audio/mp4"
BEST_EFFORT_DELETE_SECONDS = 3.0
PEAKS_MIME = "application/octet-stream"
NOTATION_SEGMENT = "notation"
NOTATION_MIME = "image/jpeg"

_EXTENSIONS: dict[str, str] = {
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mpeg": "mp3",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/aiff": "aiff",
    "audio/x-aiff": "aiff",
}


@dataclass(frozen=True)
class ObjectInfo:
    """Size and declared type of a stored object."""

    size: int
    content_type: str


@dataclass(frozen=True)
class ListedObject:
    """One key from a bucket listing, with when its object was last written."""

    key: str
    modified: datetime


def user_prefix(user_id: object) -> str:
    """The key prefix under which every object of one user lives."""
    return f"{user_id}/"


def recording_prefix(user_id: object, recording_id: object) -> str:
    """The key prefix under which every object of one recording lives."""
    return f"{user_id}/{recording_id}/"


def upload_key(user_id: object, recording_id: object) -> str:
    """Where a client PUTs the raw file."""
    return f"{recording_prefix(user_id, recording_id)}upload"


def notation_prefix(user_id: object, page_id: object) -> str:
    """The key prefix under which a notation page's image lives."""
    return f"{user_id}/{NOTATION_SEGMENT}/{page_id}/"


def notation_key(user_id: object, page_id: object) -> str:
    """Where a client PUTs a notation page's image, and where it is served from."""
    return f"{notation_prefix(user_id, page_id)}page.jpg"


def new_rev() -> str:
    """A key revision, distinct enough that two transcodes never collide."""
    return secrets.token_hex(4)


def playback_key(user_id: object, recording_id: object, rev: str) -> str:
    """The file a client downloads for one revision, so a later trim never overwrites it mid-fetch."""
    return f"{recording_prefix(user_id, recording_id)}playback-{rev}.m4a"


def peaks_key(user_id: object, recording_id: object, rev: str) -> str:
    """The waveform peaks file for one playback revision."""
    return f"{recording_prefix(user_id, recording_id)}peaks-{rev}.bin"


def is_revision_key(key: str) -> bool:
    """Whether `key` is a playback or peaks file, the keys every job attempt mints anew."""
    name = key.rpartition("/")[2]
    return name.startswith(("playback-", "peaks-"))


def original_key(user_id: object, recording_id: object, content_type: str) -> str:
    """Where the untouched upload is kept when it differs from the playback file."""
    base = content_type.split(";", 1)[0].strip().lower()
    return f"{recording_prefix(user_id, recording_id)}original.{_EXTENSIONS.get(base, 'bin')}"


@dataclass(frozen=True)
class Revision:
    """An object uploaded under a revision key no other upload reuses."""

    key: str
    rev: str
    size: int


async def upload_revision(
    store: ObjectStore,
    path: Path,
    content_type: str,
    key_for: Callable[[str], str],
    *,
    uploaded: list[str] | None = None,
) -> Revision:
    """Upload a local file under a fresh revision, so no reader of an older one sees it change.

    Args:
        store: Where the file goes.
        path: The local file.
        content_type: The type the object is served with.
        key_for: Builds the key from the new revision, such as `peaks_key` with its ids bound.
        uploaded: Gets the key appended before the upload starts, so a caller can delete
            whatever a failed attempt left behind.

    Returns:
        Revision: The key, revision, and stored byte count.
    """
    rev = new_rev()
    key = key_for(rev)
    if uploaded is not None:
        uploaded.append(key)
    return Revision(key=key, rev=rev, size=await store.upload(path, key, content_type))


async def delete_best_effort(
    store: ObjectStore, keys: Iterable[str | None], *, log: logging.Logger, message: str
) -> None:
    """Delete zero or more objects, logging instead of raising if the store call fails.

    Gives up after BEST_EFFORT_DELETE_SECONDS, so a cancelled job still cleans up
    without holding shutdown on a slow bucket. A leftover object is bounded: the next
    write to the same key overwrites it, or the runner's sweeps remove it. Never pass
    an original object's key; those are never deleted.

    Args:
        store: Where the objects live.
        keys: Keys to delete. A None entry is skipped, so a caller can pass keys
            straight from a "did this change" comparison without filtering first.
        log: The caller's logger, so a failure is attributed to the job that hit it.
        message: What to log if the delete raises.
    """
    stale = [key for key in keys if key is not None]
    if not stale:
        return
    try:
        async with asyncio.timeout(BEST_EFFORT_DELETE_SECONDS):
            await store.delete(*stale)
    except Exception:  # noqa: BLE001 -- a leftover object is bounded, not a caller failure
        log.warning(message, extra={"keys": stale})


class ObjectStore(Protocol):
    """The operations the API and runner perform on the bucket."""

    def presign_put(self, key: str, content_type: str, content_length: int, expires_in: int) -> str:
        """A URL a client can PUT one object to, with the type and length in the signature.

        The store refuses a PUT of any other length, so the declared size bounds the object.
        """
        ...

    def presign_get(self, key: str, expires_in: int) -> str:
        """A URL a client can GET one object from."""
        ...

    async def head(self, key: str) -> ObjectInfo | None:
        """Size and type of an object, or None when it does not exist."""
        ...

    async def download(self, key: str, path: Path) -> None:
        """Fetch an object into a local file."""
        ...

    async def upload(self, path: Path, key: str, content_type: str) -> int:
        """Store a local file. Returns the byte count stored."""
        ...

    async def copy(self, source: str, target: str) -> None:
        """Copy an object within the bucket."""
        ...

    async def delete(self, *keys: str) -> None:
        """Remove objects. Missing keys are not an error."""
        ...

    async def delete_prefix(self, prefix: str) -> None:
        """Remove every object under a prefix."""
        ...

    async def list_keys(self, prefix: str = "") -> list[str]:
        """Every key under `prefix`, each in full, or every key in the bucket."""
        ...

    async def list_objects(self, prefix: str = "") -> list[ListedObject]:
        """Every object under `prefix`, or in the bucket, with its last write time."""
        ...
