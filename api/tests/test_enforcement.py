"""A free account keeps every edit and delete but cannot add what Premium pays for."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

import httpx2
import pytest
from sqlalchemy import delete, select, update

from crosstune.billing.access import refresh_entitlement
from crosstune.billing.grants import grant_comp, set_trial_end
from crosstune.db.base import utc_now
from crosstune.db.engine import make_sessionmaker
from crosstune.jobs.runner import JobRunner
from crosstune.models import Job, Recording, Scan
from tests.fakes import FakeObjectStore
from tests.helpers import T0, T1, T2, change, push, recording, uid
from tests.test_import_job import AUDIO, FILE, PAGE, PAGE_HTML
from tests.test_scans_sync import scan, tune_change

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings
    from tests.conftest import MockHttp

pytestmark = pytest.mark.anyio

FREE_SCAN_QUOTA = 52_428_800
TRIAL_QUOTA = 104_857_600


async def _user_id(client, headers) -> uuid.UUID:
    response = await client.get("/v1/me", headers=headers)
    assert response.status_code == 200, response.text
    return uuid.UUID(response.json()["id"])


async def _end_trial(
    client, headers, verify_session: AsyncSession, settings: Settings
) -> uuid.UUID:
    user_id = await _user_id(client, headers)
    now = utc_now()
    await set_trial_end(verify_session, user_id, now - timedelta(seconds=1))
    await refresh_entitlement(verify_session, user_id, settings, now)
    await verify_session.commit()
    return user_id


async def _recording_slot(client, headers, rec: str, bytes_: int = 1000) -> httpx2.Response:
    return await client.post(
        f"/v1/recordings/{rec}/upload-slot",
        json={"bytes": bytes_, "content_type": "audio/mp4"},
        headers=headers,
    )


async def _scan_slot(client, headers, scan_id: str, bytes_: int = 1000) -> httpx2.Response:
    return await client.post(
        f"/v1/scans/{scan_id}/upload-slot",
        json={"bytes": bytes_, "content_type": "image/jpeg"},
        headers=headers,
    )


async def test_free_push_of_a_new_recording_is_refused(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    await _end_trial(client, headers, verify_session, settings)
    rec = uid()

    (result,) = await push(client, headers, recording(rec))

    assert result["status"] == "invalid"
    assert result["reason"] == "premium required"
    assert await verify_session.get(Recording, uuid.UUID(rec)) is None


async def test_free_rename_sending_the_stored_trim_applies(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(client, headers, recording(rec, trim_start_ms=1000, trim_end_ms=5000))
    await _end_trial(client, headers, verify_session, settings)

    (result,) = await push(
        client,
        headers,
        recording(rec, T1, label="Renamed", trim_start_ms=1000, trim_end_ms=5000),
    )

    assert result["status"] == "applied", result
    assert result["row"]["label"] == "Renamed"


async def test_free_trim_change_keeps_the_stored_trim(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(client, headers, recording(rec, trim_start_ms=1000, trim_end_ms=5000))
    # A ready file cut to the stored trim, so a changed trim would otherwise queue a trim job.
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(
            state="ready",
            playback_start_ms=1000,
            playback_end_ms=5000,
            source_duration_ms=10_000,
        )
    )
    await verify_session.commit()
    await _end_trial(client, headers, verify_session, settings)

    (result,) = await push(
        client,
        headers,
        recording(rec, T1, label="Renamed", trim_start_ms=1000, trim_end_ms=4000),
    )

    assert result["status"] == "applied", result
    assert result["row"]["label"] == "Renamed"
    assert (result["row"]["trim_start_ms"], result["row"]["trim_end_ms"]) == (1000, 5000)
    stored = await verify_session.get(Recording, uuid.UUID(rec))
    await verify_session.refresh(stored)
    assert (stored.trim_start_ms, stored.trim_end_ms) == (1000, 5000)
    jobs = await verify_session.scalars(select(Job.kind).where(Job.recording_id == uuid.UUID(rec)))
    assert "trim" not in list(jobs)


async def test_free_edit_after_a_server_trim_rewrite_applies(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(client, headers, recording(rec, trim_start_ms=1000, trim_end_ms=5000))
    # A job clamps the stored trim without moving updated_at, so the device still holds 5000.
    await verify_session.execute(
        update(Recording).where(Recording.id == rec).values(trim_end_ms=4500)
    )
    await verify_session.commit()
    await _end_trial(client, headers, verify_session, settings)

    (result,) = await push(
        client,
        headers,
        recording(rec, T1, label="Renamed", trim_start_ms=1000, trim_end_ms=5000),
    )

    assert result["status"] == "applied", result
    assert result["row"]["label"] == "Renamed"
    assert result["row"]["trim_end_ms"] == 4500


async def test_free_delete_of_a_recording_applies(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(client, headers, recording(rec))
    await _end_trial(client, headers, verify_session, settings)

    (result,) = await push(client, headers, change("recordings", rec, T1, op="delete"))

    assert result["status"] == "applied"
    assert result["row"]["deleted_at"] is not None


async def test_free_restore_of_a_deleted_recording_applies(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(client, headers, recording(rec))
    await push(client, headers, change("recordings", rec, T1, op="delete"))
    await _end_trial(client, headers, verify_session, settings)

    (result,) = await push(client, headers, recording(rec, T2, label="Back"))

    assert result["status"] == "applied", result
    assert result["row"]["deleted_at"] is None
    assert result["row"]["label"] == "Back"


async def test_free_restore_of_a_scan_off_the_scan_tune_is_refused(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    tune_a, tune_b, scan_a, scan_b = uid(), uid(), uid(), uid()
    await push(
        client,
        headers,
        tune_change(tune_a),
        tune_change(tune_b),
        scan(scan_a, tune_a, T0),
        scan(scan_b, tune_b, T1),
    )
    await push(client, headers, change("scans", scan_b, T1 + timedelta(seconds=1), op="delete"))
    await _end_trial(client, headers, verify_session, settings)

    (result,) = await push(client, headers, scan(scan_b, tune_b, T2))

    assert result["status"] == "invalid"
    assert result["reason"] == "scans are limited to one tune"
    stored = await verify_session.get(Scan, uuid.UUID(scan_b))
    await verify_session.refresh(stored)
    assert stored.deleted_at is not None


async def test_free_recording_slot_requires_premium(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(client, headers, recording(rec))
    await _end_trial(client, headers, verify_session, settings)

    response = await _recording_slot(client, headers, rec)

    assert response.status_code == 403
    assert response.json()["type"] == "urn:crosstune:premium-required"


async def test_free_scans_stay_on_the_scan_tune(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    tune_a, tune_b, scan_a, scan_b = uid(), uid(), uid(), uid()
    await push(
        client,
        headers,
        tune_change(tune_a),
        tune_change(tune_b),
        scan(scan_a, tune_a, T0),
        scan(scan_b, tune_b, T1),
    )
    await _end_trial(client, headers, verify_session, settings)

    (off_tune,) = await push(client, headers, scan(uid(), tune_b, T2))
    assert off_tune["status"] == "invalid"
    assert off_tune["reason"] == "scans are limited to one tune"

    on_tune_id = uid()
    (on_tune,) = await push(client, headers, scan(on_tune_id, tune_a, T2))
    assert on_tune["status"] == "applied"

    later = T2 + timedelta(seconds=10)
    await push(
        client,
        headers,
        change("scans", scan_a, later, op="delete"),
        change("scans", on_tune_id, later, op="delete"),
    )
    (moved,) = await push(client, headers, scan(uid(), tune_b, later))
    assert moved["status"] == "applied"


async def test_free_scan_slot_counts_scans_only_against_the_free_quota(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    tune, held, pending, rec = uid(), uid(), uid(), uid()
    await push(
        client,
        headers,
        tune_change(tune),
        scan(held, tune),
        scan(pending, tune, position=1),
        recording(rec),
    )
    await verify_session.execute(
        update(Scan).where(Scan.id == held).values(state="ready", file_bytes=FREE_SCAN_QUOTA - 1000)
    )
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(state="ready", playback_bytes=10_000_000)
    )
    await verify_session.commit()
    await _end_trial(client, headers, verify_session, settings)

    over = await _scan_slot(client, headers, pending, bytes_=1001)
    assert over.status_code == 413
    assert over.json()["type"] == "urn:crosstune:quota-exceeded"
    assert (await _scan_slot(client, headers, pending, bytes_=1000)).status_code == 200


async def test_free_scan_slot_off_the_scan_tune_is_refused(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    tune_a, tune_b, scan_a, scan_b = uid(), uid(), uid(), uid()
    await push(
        client,
        headers,
        tune_change(tune_a),
        tune_change(tune_b),
        scan(scan_a, tune_a, T0),
        scan(scan_b, tune_b, T1),
    )
    await _end_trial(client, headers, verify_session, settings)

    response = await _scan_slot(client, headers, scan_b)

    assert response.status_code == 403
    assert response.json()["type"] == "urn:crosstune:scan-tune-only"
    assert (await _scan_slot(client, headers, scan_a)).status_code == 200


async def test_trial_at_quota_then_comp_raises_it(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    held, rec = uid(), uid()
    await push(client, headers, recording(held), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == held)
        .values(state="ready", playback_bytes=TRIAL_QUOTA)
    )
    await verify_session.commit()

    assert (await _recording_slot(client, headers, rec, bytes_=1)).status_code == 413

    user_id = await _user_id(client, headers)
    now = utc_now()
    await grant_comp(
        verify_session,
        user_id,
        expires_at=None,
        storage_addon=False,
        granted_by="test",
        reason="test",
        now=now,
    )
    await refresh_entitlement(verify_session, user_id, settings, now)
    await verify_session.commit()

    assert (await _recording_slot(client, headers, rec, bytes_=1)).status_code == 200


async def test_free_import_retry_requires_premium(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(
        client,
        headers,
        recording(rec, source="import", origin="slippery_hill", origin_url=PAGE),
    )
    await verify_session.execute(delete(Job).where(Job.recording_id == rec))
    await verify_session.execute(
        update(Recording).where(Recording.id == rec).values(state="failed", error="x")
    )
    await verify_session.commit()
    await _end_trial(client, headers, verify_session, settings)

    response = await client.post(f"/v1/recordings/{rec}/retry", headers=headers)

    assert response.status_code == 403
    assert response.json()["type"] == "urn:crosstune:premium-required"


async def test_import_job_for_a_free_account_fails(
    client,
    auth_headers,
    engine,
    tmp_path,
    verify_session,
    mock_http: MockHttp,
    settings: Settings,
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(
        client,
        headers,
        recording(rec, source="import", origin="slippery_hill", origin_url=PAGE),
    )
    await _end_trial(client, headers, verify_session, settings)
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(200, content=AUDIO))
    store = FakeObjectStore()
    runner = JobRunner(
        make_sessionmaker(engine),
        store,
        work_root=tmp_path,
        http_client=mock_http.client(),
        settings=settings,
    )

    await runner.run_once()

    stored = await verify_session.get(Recording, uuid.UUID(rec))
    await verify_session.refresh(stored)
    assert stored.state == "failed"
    assert stored.error == "Premium required"
    assert store.keys() == []


async def test_me_reports_the_free_scan_quota(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    tune, scan_id, rec = uid(), uid(), uid()
    await push(client, headers, tune_change(tune), scan(scan_id, tune), recording(rec))
    await verify_session.execute(
        update(Scan).where(Scan.id == scan_id).values(state="ready", file_bytes=700)
    )
    await verify_session.execute(
        update(Recording).where(Recording.id == rec).values(state="ready", playback_bytes=9000)
    )
    await verify_session.commit()
    await _end_trial(client, headers, verify_session, settings)

    storage = (await client.get("/v1/me", headers=headers)).json()["storage"]

    assert storage["quota_bytes"] == FREE_SCAN_QUOTA
    assert storage["used_bytes"] == 700


async def test_free_stale_trim_change_reports_stale(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(client, headers, recording(rec, T1, trim_start_ms=1000, trim_end_ms=5000))
    await _end_trial(client, headers, verify_session, settings)

    (result,) = await push(
        client, headers, recording(rec, T0, trim_start_ms=1000, trim_end_ms=4000)
    )

    assert result["status"] == "stale"
    assert result["row"]["trim_end_ms"] == 5000
