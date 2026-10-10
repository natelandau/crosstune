"""One storage quota counts recordings and scans together."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from crosstune.db.base import utc_now
from crosstune.files.quota import slot_for_scan, used_bytes
from crosstune.models import Recording, Scan, UploadSlot
from tests.helpers import T0, change, push, recording, uid

pytestmark = pytest.mark.anyio


async def _me(client, auth_headers, name: str = "user_a") -> uuid.UUID:
    response = await client.get("/v1/me", headers=auth_headers(name))
    return uuid.UUID(response.json()["id"])


async def _seed(
    client, auth_headers, verify_session, *, rec_bytes=1000, scan_bytes=300
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """One ready recording and one ready scan; returns (user_id, recording_id, scan_id)."""
    user_id = await _me(client, auth_headers)
    rec, tune, scan = uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        recording(rec),
        change("tunes", tune, T0, title="X"),
        change("scans", scan, T0, tune_id=tune, position=0, width=10, height=10),
    )
    await verify_session.execute(
        update(Recording).where(Recording.id == rec).values(state="ready", playback_bytes=rec_bytes)
    )
    await verify_session.execute(
        update(Scan)
        .where(Scan.id == scan)
        .values(state="ready", file_key="k", file_bytes=scan_bytes)
    )
    await verify_session.commit()
    return user_id, uuid.UUID(rec), uuid.UUID(scan)


async def test_used_bytes_sums_recordings_and_scans(client, auth_headers, verify_session) -> None:
    user_id, _, _ = await _seed(client, auth_headers, verify_session)
    assert await used_bytes(verify_session, user_id) == 1300


async def test_open_scan_slot_replaces_its_stored_bytes(
    client, auth_headers, verify_session
) -> None:
    user_id, _, scan = await _seed(client, auth_headers, verify_session)
    verify_session.add(
        UploadSlot(
            scan_id=scan,
            user_id=user_id,
            declared_bytes=500,
            content_type="image/jpeg",
            expires_at=utc_now() + timedelta(minutes=5),
        )
    )
    await verify_session.commit()
    assert await used_bytes(verify_session, user_id) == 1500
    assert (await slot_for_scan(verify_session, scan)).declared_bytes == 500


async def test_open_slot_replaces_stored_bytes_of_a_users_only_scan(
    client, auth_headers, verify_session
) -> None:
    user_id = await _me(client, auth_headers)
    tune, scan = uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        change("scans", scan, T0, tune_id=tune, position=0, width=10, height=10),
    )
    await verify_session.execute(
        update(Scan).where(Scan.id == scan).values(state="ready", file_key="k", file_bytes=300)
    )
    await verify_session.commit()
    assert await used_bytes(verify_session, user_id) == 300
    verify_session.add(
        UploadSlot(
            scan_id=uuid.UUID(scan),
            user_id=user_id,
            declared_bytes=500,
            content_type="image/jpeg",
            expires_at=utc_now() + timedelta(minutes=5),
        )
    )
    await verify_session.commit()
    assert await used_bytes(verify_session, user_id) == 500


async def test_expired_scan_slot_counts_stored_bytes_again(
    client, auth_headers, verify_session
) -> None:
    user_id, _, scan = await _seed(client, auth_headers, verify_session)
    verify_session.add(
        UploadSlot(
            scan_id=scan,
            user_id=user_id,
            declared_bytes=500,
            content_type="image/jpeg",
            expires_at=utc_now() - timedelta(minutes=5),
        )
    )
    await verify_session.commit()
    assert await used_bytes(verify_session, user_id) == 1300


async def test_deleted_scan_does_not_count(client, auth_headers, verify_session) -> None:
    user_id, _, scan = await _seed(client, auth_headers, verify_session)
    await verify_session.execute(update(Scan).where(Scan.id == scan).values(deleted_at=utc_now()))
    await verify_session.commit()
    assert await used_bytes(verify_session, user_id) == 1000


async def test_exclude_leaves_out_one_scan(client, auth_headers, verify_session) -> None:
    user_id, rec, scan = await _seed(client, auth_headers, verify_session)
    assert await used_bytes(verify_session, user_id, exclude=scan) == 1000
    assert await used_bytes(verify_session, user_id, exclude=rec) == 300


async def test_slot_needs_exactly_one_owner(client, auth_headers, verify_session) -> None:
    user_id = await _me(client, auth_headers)
    verify_session.add(
        UploadSlot(
            user_id=user_id,
            declared_bytes=1,
            content_type="image/jpeg",
            expires_at=utc_now(),
        )
    )
    with pytest.raises(IntegrityError):
        await verify_session.commit()
    await verify_session.rollback()


async def test_me_reports_storage_quota(client, app, auth_headers) -> None:
    app.state.settings.trial_quota_bytes = 4242
    response = await client.get("/v1/me", headers=auth_headers("user_a"))
    assert response.json()["storage"]["quota_bytes"] == 4242
