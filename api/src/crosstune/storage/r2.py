"""Cloudflare R2 through its S3-compatible endpoint. boto3 is blocking, so I/O runs in threads."""

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


class R2Store:
    """An ObjectStore backed by one R2 bucket."""

    def __init__(
        self, *, account_id: str, bucket: str, access_key_id: str, secret_access_key: str
    ) -> None:
        self._bucket = bucket
        self._client: S3Client = boto3.client(
            service_name="s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",
            config=Config(signature_version="s3v4"),
        )

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
        await asyncio.to_thread(
            self._client.delete_objects,
            Bucket=self._bucket,
            Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True},
        )

    async def delete_prefix(self, prefix: str) -> None:
        """Remove every object under a prefix."""

        def run() -> None:
            paginator = self._client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
                keys = [obj["Key"] for obj in page.get("Contents", [])]
                if keys:
                    self._client.delete_objects(
                        Bucket=self._bucket,
                        Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True},
                    )

        await asyncio.to_thread(run)

    async def list_prefixes(self) -> list[str]:
        """The top-level prefixes of the bucket, each ending in a slash."""

        def run() -> list[str]:
            paginator = self._client.get_paginator("list_objects_v2")
            return [
                common["Prefix"]
                for page in paginator.paginate(Bucket=self._bucket, Delimiter="/")
                for common in page.get("CommonPrefixes", [])
                if "Prefix" in common
            ]

        return await asyncio.to_thread(run)
