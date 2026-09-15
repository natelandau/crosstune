"""What the API and the job runner need from object storage, and how keys are laid out."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from pathlib import Path

PLAYBACK_MIME = "audio/mp4"

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


def user_prefix(user_id: object) -> str:
    """The key prefix under which every object of one user lives."""
    return f"{user_id}/"


def recording_prefix(user_id: object, recording_id: object) -> str:
    """The key prefix under which every object of one recording lives."""
    return f"{user_id}/{recording_id}/"


def upload_key(user_id: object, recording_id: object) -> str:
    """Where a client PUTs the raw file."""
    return f"{recording_prefix(user_id, recording_id)}upload"


def playback_key(user_id: object, recording_id: object) -> str:
    """The file every client downloads."""
    return f"{recording_prefix(user_id, recording_id)}playback.m4a"


def original_key(user_id: object, recording_id: object, content_type: str) -> str:
    """Where the untouched upload is kept when it differs from the playback file."""
    base = content_type.split(";", 1)[0].strip().lower()
    return f"{recording_prefix(user_id, recording_id)}original.{_EXTENSIONS.get(base, 'bin')}"


class ObjectStore(Protocol):
    """The operations the API and runner perform on the bucket."""

    def presign_put(self, key: str, content_type: str, expires_in: int) -> str:
        """A URL a client can PUT one object to, with the content type in the signature."""
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

    async def copy(self, source: str, target: str, *, infrequent_access: bool) -> None:
        """Copy an object within the bucket, optionally into the Infrequent Access class."""
        ...

    async def delete(self, *keys: str) -> None:
        """Remove objects. Missing keys are not an error."""
        ...

    async def delete_prefix(self, prefix: str) -> None:
        """Remove every object under a prefix."""
        ...
