"""Presigned URL pieces shared by every router that hands out uploads and downloads."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from pydantic import BaseModel

from crosstune.db.base import utc_now
from crosstune.errors import FileTooLargeError, ServiceUnavailableError

if TYPE_CHECKING:
    from fastapi import Request

    from crosstune.storage.store import ObjectStore

UPLOAD_URL_TTL_SECONDS = 3600
DOWNLOAD_URL_TTL_SECONDS = 3600
# The signed PUT fixes the length, so this only catches a store that does not enforce it.
UPLOAD_SIZE_TOLERANCE = 0.05


class SignedUrl(BaseModel):
    """A presigned URL and when it stops working."""

    url: str
    expires_at: datetime


class StorageUnavailableError(ServiceUnavailableError):
    """No object store is configured, so uploads and downloads cannot be served."""

    def __init__(self) -> None:
        super().__init__("File storage is not configured")


def file_too_large(limit: int) -> FileTooLargeError:
    """The error for a file over the per-file cap."""
    msg = f"Files are limited to {limit} bytes"
    return FileTooLargeError(msg)


def require_store(request: Request) -> ObjectStore:
    """The app's object store, or a 503 when the deployment has none."""
    store = request.app.state.object_store
    if store is None:
        raise StorageUnavailableError
    return store


def presign_get(store: ObjectStore, key: str) -> tuple[str, datetime]:
    """A presigned GET url for an object key, with the download TTL's own expiry."""
    url = store.presign_get(key, DOWNLOAD_URL_TTL_SECONDS)
    return url, utc_now() + timedelta(seconds=DOWNLOAD_URL_TTL_SECONDS)
