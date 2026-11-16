"""Request builders and canned payloads that more than one test module sends."""

from __future__ import annotations

import base64
import hashlib
import hmac
import subprocess
import time
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import httpx2
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.billing.grants import PaidSubscription
from crosstune.config import Settings
from crosstune.db.base import utc_now
from crosstune.db.locks import lock_user
from crosstune.main import create_app
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantPeriod, GrantSource

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncEngine


def ec_pem(key: ec.EllipticCurvePrivateKey | None = None) -> str:
    """Encode `key`, or a new P-256 key, as the PKCS8 PEM an Apple signing key setting holds."""
    key = key if key is not None else ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


# For a job a test calls directly, outside a runner: only its quota sizes are read.
JOB_SETTINGS = Settings(database_url="postgresql+asyncpg://localhost/unused")

GAPPED_WEBM_GAP_MS = 59
GAPPED_WEBM_GAP_AT_S = 1.0
STEPPED_BACK_MS = 10
WEBM_START_OFFSET_S = 2.0
# Where the gapped WebM's stall begins and ends, in ms on its timestamp timeline.
GAPPED_STALL_MS = (1034, 1093)
LONG_STALL_GAP_MS = 3000
# Where the long-stalled WebM's stall begins and ends, in ms on its timestamp timeline.
LONG_STALL_MS = (1034, 4034)
DRIFT_RATIO = 0.0005

T0 = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)
T1 = T0 + timedelta(seconds=10)
T2 = T0 + timedelta(seconds=20)

WEBHOOK_SECRET = (
    "whsec_dGVzdHNlY3JldHRlc3RzZWNyZXQ="  # gitleaks:allow -- fixture, not a real secret
)

OEMBED = {
    "title": "Angeline the Baker - Old Time Fiddle",
    "thumbnail_url": "https://i.ytimg.com/vi/x/hq.jpg",
}


class Clock:
    """A monotonic clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def premium_ended(expires_at: datetime | str | None) -> bool:
    """Whether an entitlements row's reported grant has ended, so the account is free.

    A free account still names the grant it lost last, so its source alone says nothing.
    """
    if expires_at is None:
        return False
    ended = datetime.fromisoformat(expires_at) if isinstance(expires_at, str) else expires_at
    return ended <= datetime.now(UTC)


def uid() -> str:
    return str(uuid.uuid4())


def change(table: str, id_: str, updated_at: datetime, op: str = "upsert", **data) -> dict:
    body = {"table": table, "op": op, "id": id_, "updated_at": updated_at.isoformat()}
    if op == "upsert":
        body["data"] = {"created_at": updated_at.isoformat(), **data}
    return body


def recording(id_: str, at=T0, **data) -> dict:
    fields = {
        "source": "microphone",
        "added_at": at.isoformat(),
        "recorded_at": at.isoformat(),
        "recorded_precision": "time",
        "position": 0,
    }
    fields.update(data)
    return change("recordings", id_, at, **fields)


async def push(client: httpx2.AsyncClient, headers: dict, *changes: dict) -> list[dict]:
    response = await client.post("/v1/sync/push", json={"changes": list(changes)}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["results"]


def web_subscription(
    *,
    started: timedelta = timedelta(days=3),
    source: GrantSource = GrantSource.STRIPE,
    subscription_id: str = "sub_1",
) -> PaidSubscription:
    """A monthly Premium subscription as RevenueCat reports it, started `started` ago."""
    now = utc_now()
    return PaidSubscription(
        subscription_id=subscription_id,
        store_id=f"si_{subscription_id}",
        source=source,
        kind=GrantKind.PREMIUM,
        environment=GrantEnvironment.PRODUCTION,
        expires_at=now - started + timedelta(days=30),
        auto_renews=True,
        started_at=now - started,
        period=GrantPeriod.MONTH,
    )


@asynccontextmanager
async def hold_account_lock(engine: AsyncEngine, user_id: uuid.UUID) -> AsyncIterator[None]:
    """Hold the account's user lock from a session of its own until the block ends."""
    async with AsyncSession(bind=engine) as holder:
        await lock_user(holder, user_id)
        try:
            yield
        finally:
            await holder.rollback()


async def pull(client: httpx2.AsyncClient, headers: dict, since: int = 0) -> dict:
    response = await client.get(f"/v1/sync/pull?since={since}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def sign(
    body: bytes, secret: str = WEBHOOK_SECRET, msg_id: str = "msg_1", ts: int | None = None
) -> dict[str, str]:
    ts = ts or int(time.time())
    key = base64.b64decode(secret.removeprefix("whsec_"))
    signed = f"{msg_id}.{ts}.".encode() + body
    sig = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    return {"svix-id": msg_id, "svix-timestamp": str(ts), "svix-signature": f"v1,{sig}"}


def og_html(title: str) -> str:
    return f'<html><head><meta property="og:title" content="{title}" /></head></html>'


def make_tone(path: Path, seconds: int) -> None:
    """Encode a sine tone of `seconds` to an AAC M4A at `path`, for a test that needs real audio."""
    subprocess.run(  # noqa: S603 -- fixed argv, no shell
        [  # noqa: S607 -- resolved from PATH, no shell
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={seconds}",
            "-c:a",
            "aac",
            "-f",
            "mp4",
            str(path),
        ],
        check=True,
    )


async def unhandled_error_response(path: str, *, debug: bool = False) -> httpx2.Response:
    """Answer a request whose route raises, as a client of the deployed API would see it.

    The `client` fixture re-raises app exceptions, so it never sees the 500 the API sends.
    """
    app = create_app(Settings(debug=debug))

    @app.get(path)
    async def boom() -> None:
        msg = "kaboom"
        raise RuntimeError(msg)

    transport = httpx2.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx2.AsyncClient(transport=transport, base_url="http://testclient") as client:
        return await client.get(path)
