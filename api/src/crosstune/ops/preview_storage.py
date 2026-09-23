"""Seed one pull request's audio from development, and remove it at teardown.

The Preview workflow runs this. The development token it reads is read-only, and
the preview token holds nothing on the development bucket, so a copy goes through
this process instead of a server-side copy.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from typing import TYPE_CHECKING

from crosstune.config import PREVIEW_BUCKET
from crosstune.storage.r2 import R2Store, s3_client

if TYPE_CHECKING:
    from types_boto3_s3 import S3Client

    from crosstune.storage.store import ObjectStore

__all__ = ["DEV_BUCKET", "PREVIEW_BUCKET", "main", "pr_prefix", "seed", "teardown"]

DEV_BUCKET = "crosstune-recordings-dev"
_PR_NAME = re.compile(r"pr-[0-9]+")


def pr_prefix(pr_name: str) -> str:
    """The key prefix of one pull request.

    An empty or malformed name would reach every other pull request's audio.

    Raises:
        ValueError: When the name is not `pr-<number>`.
    """
    if not _PR_NAME.fullmatch(pr_name):
        msg = f"{pr_name!r} is not a pull request environment name like pr-12"
        raise ValueError(msg)
    return f"{pr_name}/"


def _sizes(client: S3Client, bucket: str, prefix: str = "") -> dict[str, int]:
    scope = {"Prefix": prefix} if prefix else {}
    pages = client.get_paginator("list_objects_v2").paginate(Bucket=bucket, **scope)
    return {
        obj["Key"][len(prefix) :]: obj["Size"] for page in pages for obj in page.get("Contents", [])
    }


def seed(
    source: S3Client, source_bucket: str, target: S3Client, target_bucket: str, prefix: str
) -> int:
    """Copy every source object missing under the prefix in the target, keeping its content type.

    Returns:
        int: How many objects were copied.
    """
    present = _sizes(target, target_bucket, prefix)
    copied = 0
    for key, size in _sizes(source, source_bucket).items():
        if present.get(key) == size:
            continue
        obj = source.get_object(Bucket=source_bucket, Key=key)
        target.upload_fileobj(
            obj["Body"],
            target_bucket,
            prefix + key,
            ExtraArgs={"ContentType": obj.get("ContentType", "application/octet-stream")},
        )
        copied += 1
    return copied


async def teardown(store: ObjectStore, prefix: str) -> None:
    """Remove every object of one pull request."""
    await store.delete_prefix(prefix)


def _env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        sys.exit(f"{name} is not set")
    return value


def main(argv: list[str] | None = None) -> int:
    """Seed or tear down one pull request's audio in the preview bucket."""
    parser = argparse.ArgumentParser(prog="preview_storage", description=__doc__)
    parser.add_argument("command", choices=["seed", "teardown"])
    parser.add_argument("pr_name", help="the environment name, pr-<number>")
    args = parser.parse_args(argv)
    prefix = pr_prefix(args.pr_name)
    endpoint = f"https://{_env('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com"
    preview_key, preview_secret = (
        _env("R2_PREVIEW_ACCESS_KEY_ID"),
        _env("R2_PREVIEW_SECRET_ACCESS_KEY"),
    )
    if args.command == "seed":
        dev = s3_client(
            endpoint, _env("R2_DEV_READ_ACCESS_KEY_ID"), _env("R2_DEV_READ_SECRET_ACCESS_KEY")
        )
        preview = s3_client(endpoint, preview_key, preview_secret)
        copied = seed(dev, DEV_BUCKET, preview, PREVIEW_BUCKET, prefix)
        print(f"copied {copied} objects into {PREVIEW_BUCKET}/{prefix}")
    else:
        store = R2Store(
            endpoint_url=endpoint,
            bucket=PREVIEW_BUCKET,
            access_key_id=preview_key,
            secret_access_key=preview_secret,
        )
        asyncio.run(teardown(store, prefix))
        print(f"removed {PREVIEW_BUCKET}/{prefix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
