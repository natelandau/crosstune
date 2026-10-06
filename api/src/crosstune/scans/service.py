"""Queries and transitions shared by the scans router and the job runner."""

from __future__ import annotations

from typing import TYPE_CHECKING

from crosstune.errors import ConflictError, NotFoundError
from crosstune.models import Scan, Tune

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.vocabulary import ScanState


async def owned_scan(session: AsyncSession, user_id: uuid.UUID, scan_id: uuid.UUID) -> Scan:
    """The caller's live scan on a live tune, or a 404 that does not reveal whether the id exists.

    Args:
        session: The session to query through.
        user_id: The caller.
        scan_id: The scan named in the URL.

    Returns:
        Scan: The row.
    """
    scan = await session.get(Scan, scan_id)
    if scan is None or scan.user_id != user_id:
        raise NotFoundError
    await require_live(session, scan)
    return scan


async def require_live(session: AsyncSession, scan: Scan) -> None:
    """Raise a 404 when the scan or its tune is tombstoned.

    The tune is read from the database, not the session's identity map, so a caller
    that re-checks under the user's lock sees a delete committed meanwhile.

    Args:
        session: The session to query through.
        scan: The scan, already read or refreshed by the caller.
    """
    if scan.deleted_at is not None:
        raise NotFoundError
    tune = await session.get(Tune, scan.tune_id, populate_existing=True)
    if tune is None or tune.deleted_at is not None:
        raise NotFoundError


def require_state(scan: Scan, expected: ScanState) -> None:
    """Raise a conflict naming the scan's actual state when it is not the expected one.

    Args:
        scan: The scan to check.
        expected: The state the caller's operation allows.
    """
    if scan.state != expected:
        msg = f"Scan is {scan.state}, not {expected}"
        raise ConflictError(msg)
