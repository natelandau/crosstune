"""Cloudflare R2, or RustFS locally, through the S3 API. boto3 is blocking, so I/O runs in threads."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from crosstune.storage.store import ObjectInfo

if TYPE_CHECKING:
    from pathlib import Path

    from types_boto3_s3 import S3Client


class ObjectDeleteError(Exception):
    """The bucket accepted a batch delete but reported some of its keys as not removed."""


def s3_client(endpoint_url: str, access_key_id: str, secret_access_key: str) -> S3Client:
    """A client for an S3-compatible endpoint."""
    return boto3.client(
        service_name="s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        # R2 signs for "auto"; other S3 servers reject any region but their own default.
        region_name="auto" if endpoint_url.endswith(".r2.cloudflarestorage.com") else "us-east-1",
        config=Config(signature_version="s3v4"),
    )


class R2Store:
    """An ObjectStore backed by one bucket."""

    def __init__(
        self, *, endpoint_url: str, bucket: str, access_key_id: str, secret_access_key: str
    ) -> None:
        self._bucket = bucket
        self._client: S3Client = s3_client(endpoint_url, access_key_id, secret_access_key)

    def presign_put(self, key: str, content_type: str, expires_in: int) -> str:
        """A URL a client can PUT one object to, with the content type in the signature."""
        return self._client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self._bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )

    def presign_get(self, key: str, expires_in: int) -> str:
        """A URL a client can GET one object from."""
        return self._client.generate_presigned_url(
            "get_object", Params={"Bucket": self._bucket, "Key": key}, ExpiresIn=expires_in
        )

    async def head(self, key: str) -> ObjectInfo | None:
        """Size and type of an object, or None when it does not exist."""

        def run() -> ObjectInfo | None:
            try:
                response = self._client.head_object(Bucket=self._bucket, Key=key)
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                    return None
                raise
            return ObjectInfo(
                size=int(response["ContentLength"]),
                content_type=response.get("ContentType", "application/octet-stream"),
            )

        return await asyncio.to_thread(run)

    async def download(self, key: str, path: Path) -> None:
        """Fetch an object into a local file."""
        await asyncio.to_thread(self._client.download_file, self._bucket, key, str(path))

    async def upload(self, path: Path, key: str, content_type: str) -> int:
        """Store a local file. Returns the byte count stored."""
        await asyncio.to_thread(
            self._client.upload_file,
            str(path),
            self._bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        return await asyncio.to_thread(lambda: path.stat().st_size)

    async def copy(self, source: str, target: str) -> None:
        """Copy an object within the bucket.

        No storage class is ever passed. Infrequent Access has no free tier and bills
        operations rounded up to the next million, so one object there costs more in
        a month than every Standard object the free tier covers.
        """
        await asyncio.to_thread(
            self._client.copy_object,
            Bucket=self._bucket,
            Key=target,
            CopySource={"Bucket": self._bucket, "Key": source},
        )

    async def delete(self, *keys: str) -> None:
        """Remove objects. Missing keys are not an error."""
        if not keys:
            return
        await asyncio.to_thread(self._delete_keys, list(keys))

    async def delete_prefix(self, prefix: str) -> None:
        """Remove every object under a prefix."""

        def run() -> None:
            paginator = self._client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
                keys = [obj["Key"] for obj in page.get("Contents", [])]
                if keys:
                    self._delete_keys(keys)

        await asyncio.to_thread(run)

    def _delete_keys(self, keys: list[str]) -> None:
        # A batch delete answers 200 and lists the keys it could not remove; only an
        # error makes the caller retry, so those keys must not pass silently.
        response = self._client.delete_objects(
            Bucket=self._bucket,
            Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True},
        )
        errors = response.get("Errors", [])
        if errors:
            first = errors[0]
            msg = (
                f"{len(errors)} of {len(keys)} objects were not deleted; "
                f"{first.get('Key')}: {first.get('Code')} {first.get('Message')}"
            )
            raise ObjectDeleteError(msg)

    async def list_keys(self, prefix: str = "") -> list[str]:
        """Every key under `prefix`, each in full, or every key in the bucket."""
        scope = {"Prefix": prefix} if prefix else {}

        def run() -> list[str]:
            paginator = self._client.get_paginator("list_objects_v2")
            return [
                obj["Key"]
                for page in paginator.paginate(Bucket=self._bucket, **scope)
                for obj in page.get("Contents", [])
                if "Key" in obj
            ]

        return await asyncio.to_thread(run)
