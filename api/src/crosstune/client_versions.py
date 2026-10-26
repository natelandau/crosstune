"""Record which client version each account last called with, at most once an hour."""

import logging
import uuid
from collections import OrderedDict
from datetime import datetime, timedelta

from asyncpg.exceptions import LockNotAvailableError
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from crosstune.client_version import ClientVersion
from crosstune.models import AccountClientVersion

logger = logging.getLogger(__name__)

# How stale a recorded version may grow before it is written again, so most requests write nothing.
RECORD_GRANULARITY = timedelta(hours=1)
_MAX_REMEMBERED = 10_000
# Where `current_user` leaves the account it resolved, for `VersionGate` to record.
CLIENT_VERSION_USER_STATE_KEY = "client_version_user_id"


class RecordedClientVersions:
    """What this process last recorded for each account and platform.

    It lives in process memory, so a restart or another replica merely writes once more;
    the row's own guard keeps that write harmless.
    """

    def __init__(self) -> None:
        self._seen: OrderedDict[tuple[uuid.UUID, str], tuple[str, datetime]] = OrderedDict()
        self._accounts: OrderedDict[str, uuid.UUID] = OrderedDict()

    def due(self, user_id: uuid.UUID, client: ClientVersion, now: datetime) -> bool:
        """Whether the pair is unknown, changed version, or was last seen over an hour ago."""
        last = self._seen.get((user_id, client.platform))
        return last is None or last[0] != client.text or now - last[1] > RECORD_GRANULARITY

    def seen(self, user_id: uuid.UUID, client: ClientVersion, now: datetime) -> None:
        """Remember the pair as recorded, evicting the oldest beyond the cap."""
        key = (user_id, client.platform)
        self._seen[key] = (client.text, now)
        self._seen.move_to_end(key)
        while len(self._seen) > _MAX_REMEMBERED:
            self._seen.popitem(last=False)

    def account(self, clerk_user_id: str) -> uuid.UUID | None:
        """The account last resolved for a Clerk user, so a blocked build skips the lookup."""
        return self._accounts.get(clerk_user_id)

    def remember_account(self, clerk_user_id: str, user_id: uuid.UUID) -> None:
        """Remember which account a Clerk user is, evicting the oldest beyond the cap."""
        self._accounts[clerk_user_id] = user_id
        self._accounts.move_to_end(clerk_user_id)
        while len(self._accounts) > _MAX_REMEMBERED:
            self._accounts.popitem(last=False)


async def record_client_version(
    sessionmaker: async_sessionmaker[AsyncSession],
    recorded: RecordedClientVersions,
    user_id: uuid.UUID,
    client: ClientVersion,
    now: datetime,
) -> None:
    """Record the account's client version, at most once an hour per platform.

    The write commits in its own transaction. A sync request holds the per-user advisory
    lock through its commit, so a row lock taken inside that transaction could deadlock
    with another request that took the row first and then waited for the lock.

    Args:
        sessionmaker: Opens the write's own session.
        recorded: This process's memory of what it already recorded.
        user_id: The calling account.
        client: The calling client.
        now: The time to record.
    """
    if not recorded.due(user_id, client, now):
        return
    insert_stmt = insert(AccountClientVersion).values(
        user_id=user_id, platform=client.platform, version=client.text, last_seen_at=now
    )
    upsert = insert_stmt.on_conflict_do_update(
        index_elements=["user_id", "platform"],
        set_={
            "version": insert_stmt.excluded.version,
            "last_seen_at": insert_stmt.excluded.last_seen_at,
        },
        where=(AccountClientVersion.version != insert_stmt.excluded.version)
        | (
            AccountClientVersion.last_seen_at
            < insert_stmt.excluded.last_seen_at - RECORD_GRANULARITY
        ),
    )
    try:
        async with sessionmaker() as session:
            # The foreign key check waits on the account row, which a sync holds through its
            # commit. A recorded version is worth less than the request it rides on.
            await session.execute(text("set local lock_timeout = '200ms'"))
            await session.execute(upsert)
            await session.commit()
    except DBAPIError as exc:
        # Losing to a sync's row lock is routine; the next due request records it.
        if isinstance(exc.orig.__cause__ if exc.orig else None, LockNotAvailableError):
            logger.debug("client version not recorded: account row locked")
        else:
            logger.warning("could not record the client version", exc_info=True)
        return
    except SQLAlchemyError:
        logger.warning("could not record the client version", exc_info=True)
        return
    recorded.seen(user_id, client, now)
