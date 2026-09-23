"""Buckets in the RustFS that compose.yml starts. Every command is confined to it."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING

from botocore.exceptions import BotoCoreError, ClientError

from crosstune.config import E2E_BUCKET, LOCAL_BUCKET
from crosstune.storage.r2 import s3_client

if TYPE_CHECKING:
    from types_boto3_s3 import S3Client

ENDPOINT = "http://localhost:9000"
ACCESS_KEY = "crosstune"
SECRET_KEY = "crosstune-local-secret"  # noqa: S105 -- the fixed local credential compose.yml sets
BUCKETS = (LOCAL_BUCKET, E2E_BUCKET)
CORS_ORIGINS = ["http://localhost:5173", "http://localhost:4173"]


def client() -> S3Client:
    """A client for the local RustFS."""
    return s3_client(ENDPOINT, ACCESS_KEY, SECRET_KEY)


def wait_until_ready(client: S3Client, timeout: float = 60) -> None:
    """Block until RustFS answers, since `docker compose up` returns before it listens.

    Raises:
        BotoCoreError: When nothing answers before the timeout.
        ClientError: When RustFS answers with an error before the timeout.
    """
    deadline = time.monotonic() + timeout
    while True:
        try:
            client.list_buckets()
        except (BotoCoreError, ClientError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)
        else:
            return


def ensure_bucket(client: S3Client, bucket: str) -> None:
    """Create the bucket if absent and give it the CORS rules browser uploads need."""
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError:
        client.create_bucket(Bucket=bucket)
    client.put_bucket_cors(
        Bucket=bucket,
        CORSConfiguration={
            "CORSRules": [
                {
                    "AllowedOrigins": CORS_ORIGINS,
                    "AllowedMethods": ["GET", "PUT", "HEAD"],
                    "AllowedHeaders": ["Content-Type"],
                    "ExposeHeaders": ["ETag"],
                    "MaxAgeSeconds": 3600,
                }
            ]
        },
    )


def empty_bucket(client: S3Client, bucket: str) -> int:
    """Delete every object in the bucket. Returns how many were removed."""
    removed = 0
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        contents = page.get("Contents", [])
        if contents:
            client.delete_objects(
                Bucket=bucket,
                Delete={"Objects": [{"Key": obj["Key"]} for obj in contents], "Quiet": True},
            )
            removed += len(contents)
    return removed


def _setup(client: S3Client, _args: argparse.Namespace) -> None:
    wait_until_ready(client)
    for bucket in BUCKETS:
        ensure_bucket(client, bucket)
    print(f"RustFS at {ENDPOINT} has {', '.join(BUCKETS)}. Console: http://localhost:9001")


def _ls(client: S3Client, args: argparse.Namespace) -> None:
    pages = client.get_paginator("list_objects_v2").paginate(Bucket=args.bucket, Prefix=args.prefix)
    for page in pages:
        for obj in page.get("Contents", []):
            print(f"{obj['Size']:>12}  {obj['Key']}")


def _get(client: S3Client, args: argparse.Namespace) -> None:
    dest = args.cwd / (args.dest or Path(args.key).name)
    client.download_file(args.bucket, args.key, str(dest))
    print(f"saved {args.key} to {dest}")


def _reset(client: S3Client, args: argparse.Namespace) -> None:
    print(f"removed {empty_bucket(client, args.bucket)} objects from {args.bucket}")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="just api::storage", description=__doc__)
    # just runs recipes from the module's directory, not the one the user typed in.
    parser.add_argument(
        "--cwd", type=Path, default=Path(), help="directory a relative destination is under"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("setup", help="create both buckets and their CORS rules").set_defaults(
        run=_setup
    )
    ls = commands.add_parser("ls", help="list objects under a prefix")
    ls.add_argument("prefix", nargs="?", default="")
    ls.add_argument("--bucket", choices=BUCKETS, default=LOCAL_BUCKET)
    ls.set_defaults(run=_ls)
    get = commands.add_parser("get", help="download one object")
    get.add_argument("key")
    get.add_argument("dest", nargs="?")
    get.add_argument("--bucket", choices=BUCKETS, default=LOCAL_BUCKET)
    get.set_defaults(run=_get)
    reset = commands.add_parser("reset", help="delete every object in a bucket")
    reset.add_argument("bucket", nargs="?", choices=BUCKETS, default=LOCAL_BUCKET)
    reset.set_defaults(run=_reset)
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run one command against the local RustFS."""
    args = _parser().parse_args(argv)
    args.run(client(), args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
