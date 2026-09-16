"""In-memory stand-ins for hosted services."""

from __future__ import annotations

from typing import TYPE_CHECKING

from crosstune.storage.store import ObjectInfo

if TYPE_CHECKING:
    from pathlib import Path


class FakeObjectStore:
    """An ObjectStore held in a dict. Presigned URLs are recognizable strings, not signatures."""

    def __init__(self) -> None:
        self._objects: dict[str, tuple[bytes, str]] = {}
        self.presigned: list[tuple[str, str]] = []

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        """What a client's PUT to a presigned URL leaves behind."""
        self._objects[key] = (data, content_type)

    def get_bytes(self, key: str) -> bytes:
        """The stored bytes of one object."""
        return self._objects[key][0]

    def keys(self) -> list[str]:
        """Every stored key, sorted."""
        return sorted(self._objects)

    def presign_put(self, key: str, content_type: str, expires_in: int) -> str:
        """A URL a client can PUT one object to, with the content type in the signature."""
        self.presigned.append(("put", key))
        return f"https://fake.r2/{key}?put&content_type={content_type}&expires={expires_in}"

    def presign_get(self, key: str, expires_in: int) -> str:
        """A URL a client can GET one object from."""
        self.presigned.append(("get", key))
        return f"https://fake.r2/{key}?get&expires={expires_in}"

    async def head(self, key: str) -> ObjectInfo | None:
        """Size and type of an object, or None when it does not exist."""
        stored = self._objects.get(key)
        if stored is None:
            return None
        return ObjectInfo(size=len(stored[0]), content_type=stored[1])

    async def download(self, key: str, path: Path) -> None:
        """Fetch an object into a local file."""
        path.write_bytes(self._objects[key][0])  # noqa: ASYNC240 -- in-memory fake, no real I/O

    async def upload(self, path: Path, key: str, content_type: str) -> int:
        """Store a local file. Returns the byte count stored."""
        data = path.read_bytes()  # noqa: ASYNC240 -- in-memory fake, no real I/O
        self._objects[key] = (data, content_type)
        return len(data)

    async def copy(self, source: str, target: str) -> None:
        """Copy an object within the bucket."""
        self._objects[target] = self._objects[source]

    async def delete(self, *keys: str) -> None:
        """Remove objects. Missing keys are not an error."""
        for key in keys:
            self._objects.pop(key, None)

    async def delete_prefix(self, prefix: str) -> None:
        """Remove every object under a prefix."""
        for key in [k for k in self._objects if k.startswith(prefix)]:
            del self._objects[key]

    async def list_prefixes(self) -> list[str]:
        """The top-level prefixes of the bucket, each ending in a slash."""
        return sorted({key.split("/", 1)[0] + "/" for key in self._objects if "/" in key})
