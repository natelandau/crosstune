"""Tests for the rules that decide when a split holds its parent's original and when it completes."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from crosstune.models import Recording, User
from crosstune.recordings.split_rules import (
    latest_split_pieces,
    split_holds_original,
    split_ready_to_complete,
)
from tests.helpers import T0, uid

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


async def _user_id(session: AsyncSession) -> uuid.UUID:
    user = User(clerk_user_id=f"user_{uid()}")
    session.add(user)
    await session.flush()
    return user.id


def _recording(user_id: uuid.UUID, **values) -> Recording:
    fields = {
        "id": uuid.UUID(uid()),
        "user_id": user_id,
        "source": "microphone",
        "added_at": T0,
        "recorded_at": T0,
        "recorded_precision": "time",
        "position": 0,
        "created_at": T0,
        "updated_at": T0,
    }
    fields.update(values)
    return Recording(**fields)


async def _piece_ids(session: AsyncSession, parent: Recording) -> set[uuid.UUID]:
    return set(
        await session.scalars(
            select(Recording.id).where(latest_split_pieces(parent.id, parent.split_id))
        )
    )


async def _piece(session: AsyncSession, parent: Recording, **values) -> Recording:
    piece = _recording(
        parent.user_id, split_from_id=parent.id, created_by_split_id=parent.split_id, **values
    )
    session.add(piece)
    await session.flush()
    return piece


async def test_split_completes_once_every_piece_arrives_with_its_slice(session) -> None:
    user_id = await _user_id(session)
    parent = _recording(user_id, state="ready", split_id=uuid.UUID(uid()), split_size=3)
    session.add(parent)
    await session.flush()
    assert not await split_ready_to_complete(session, parent)

    first = await _piece(session, parent, state="ready", original_key="a")
    assert not await split_ready_to_complete(session, parent)

    second = await _piece(session, parent, state="processing")
    assert not await split_ready_to_complete(session, parent)

    second.state, second.original_key = "ready", "b"
    await session.flush()
    assert await split_ready_to_complete(session, parent)
    assert await _piece_ids(session, parent) == {first.id, second.id}


async def test_a_piece_ready_without_its_slice_keeps_the_split_open(session) -> None:
    user_id = await _user_id(session)
    parent = _recording(user_id, state="ready", split_id=uuid.UUID(uid()), split_size=2)
    session.add(parent)
    await session.flush()
    await _piece(session, parent, state="ready")
    assert not await split_ready_to_complete(session, parent)


async def test_deleted_piece_counts_toward_complete(session) -> None:
    user_id = await _user_id(session)
    parent = _recording(user_id, state="ready", split_id=uuid.UUID(uid()), split_size=2)
    session.add(parent)
    await session.flush()
    await _piece(session, parent, state="processing", deleted_at=T0)
    assert await split_ready_to_complete(session, parent)
    assert not await split_holds_original(session, parent)


async def test_parent_without_a_split_holds_nothing(session) -> None:
    user_id = await _user_id(session)
    parent = _recording(user_id, state="ready")
    session.add(parent)
    await session.flush()
    assert not await split_ready_to_complete(session, parent)
    assert not await split_holds_original(session, parent)
    assert await _piece_ids(session, parent) == set()


async def test_completed_split_never_completes_again(session) -> None:
    user_id = await _user_id(session)
    split = uuid.UUID(uid())
    parent = _recording(
        user_id, state="ready", split_id=split, split_size=2, split_completed_id=split
    )
    session.add(parent)
    await session.flush()
    await _piece(session, parent, state="ready", original_key="a")
    assert not await split_ready_to_complete(session, parent)


async def test_a_failed_piece_keeps_the_split_open_but_holds_nothing(session) -> None:
    user_id = await _user_id(session)
    parent = _recording(user_id, state="ready", split_id=uuid.UUID(uid()), split_size=2)
    session.add(parent)
    await session.flush()
    piece = await _piece(session, parent, state="failed")
    assert not await split_ready_to_complete(session, parent)
    assert not await split_holds_original(session, parent)
    piece.deleted_at = T0
    await session.flush()
    assert await split_ready_to_complete(session, parent)


async def test_only_a_waiting_piece_holds_the_original(session) -> None:
    user_id = await _user_id(session)
    parent = _recording(user_id, state="ready", split_id=uuid.UUID(uid()), split_size=3)
    session.add(parent)
    await session.flush()
    assert not await split_holds_original(session, parent)
    piece = await _piece(session, parent, state="processing")
    assert await split_holds_original(session, parent)
    piece.deleted_at = T0
    await session.flush()
    assert not await split_holds_original(session, parent)


async def test_a_piece_of_an_earlier_split_holds_the_original(session) -> None:
    user_id = await _user_id(session)
    parent = _recording(user_id, state="ready", split_id=uuid.UUID(uid()), split_size=2)
    session.add(parent)
    await session.flush()
    await _piece(session, parent, state="processing")
    parent.split_id = uuid.UUID(uid())
    await session.flush()
    assert await split_holds_original(session, parent)


async def test_a_failed_parent_holds_nothing(session) -> None:
    user_id = await _user_id(session)
    parent = _recording(user_id, state="failed", split_id=uuid.UUID(uid()), split_size=2)
    session.add(parent)
    await session.flush()
    await _piece(session, parent, state="processing")
    assert not await split_holds_original(session, parent)
