"""An ObjectStore confined to one key prefix of a bucket other environments share."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from crosstune.storage.store import ObjectInfo, ObjectStore


class PrefixedStore:
    """Adds a prefix to every key, so callers and database rows keep logical keys."""

    def __init__(self, inner: ObjectStore, prefix: str) -> None:
        if not prefix.endswith("/"):
            msg = f"a store prefix must end in /, not {prefix!r}"
            raise ValueError(msg)
        self._inner = inner
        self._prefix = prefix

    def _key(self, key: str) -> str:
        return self._prefix + key

    def presign_put(self, key: str, content_type: str, content_length: int, expires_in: int) -> str:
        """A URL a client can PUT one object to, with the type and length in the signature."""
        return self._inner.presign_put(self._key(key), content_type, content_length, expires_in)

    def presign_get(self, key: str, expires_in: int) -> str:
        """A URL a client can GET one object from."""
        return self._inner.presign_get(self._key(key), expires_in)

    async def head(self, key: str) -> ObjectInfo | None:
        """Size and type of an object, or None when it does not exist."""
        return await self._inner.head(self._key(key))

    async def download(self, key: str, path: Path) -> None:
        """Fetch an object into a local file."""
        await self._inner.download(self._key(key), path)

    async def upload(self, path: Path, key: str, content_type: str) -> int:
        """Store a local file. Returns the byte count stored."""
        return await self._inner.upload(path, self._key(key), content_type)

    async def copy(self, source: str, target: str) -> None:
        """Copy an object within the prefix."""
        await self._inner.copy(self._key(source), self._key(target))

    async def delete(self, *keys: str) -> None:
        """Remove objects. Missing keys are not an error."""
        await self._inner.delete(*(self._key(key) for key in keys))

    async def delete_prefix(self, prefix: str) -> None:
        """Remove every object under a prefix."""
        await self._inner.delete_prefix(self._key(prefix))

    async def list_keys(self, prefix: str = "") -> list[str]:
        """Every key under `prefix`, each in full, or every key within this store's prefix."""
        listed = await self._inner.list_keys(self._key(prefix))
        return [key[len(self._prefix) :] for key in listed]
