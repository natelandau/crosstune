"""Request builders and canned payloads that more than one test module sends."""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import httpx2

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
