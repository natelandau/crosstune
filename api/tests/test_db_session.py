"""Per-request session dependency commits on success and rolls back on error."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx2
import pytest
from fastapi import Depends, FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.engine import make_sessionmaker
from crosstune.db.session import DbSession, get_session
from crosstune.models import User

if TYPE_CHECKING:
    from starlette.types import Message, Receive, Scope, Send

pytestmark = pytest.mark.anyio


async def test_get_session_commits_on_success(engine) -> None:
    app = FastAPI()
    app.state.sessionmaker = make_sessionmaker(engine)

    @app.get("/ping")
    async def ping(session=Depends(get_session)) -> dict[str, bool]:
        return {"active": session.is_active}

    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as client:
        response = await client.get("/ping")

    assert response.status_code == 200
    assert response.json() == {"active": True}


async def test_get_session_rolls_back_on_error(engine, verify_session: AsyncSession) -> None:
    app = FastAPI()
    app.state.sessionmaker = make_sessionmaker(engine)

    @app.get("/boom")
    async def boom(session=Depends(get_session)) -> None:
        session.add(User(clerk_user_id="user_rolled_back"))
        await session.flush()
        msg = "boom"
        raise ValueError(msg)

    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as client:
        with pytest.raises(ValueError, match="boom"):
            await client.get("/boom")

    written = await verify_session.scalar(
        select(User).where(User.clerk_user_id == "user_rolled_back")
    )
    assert written is None


async def test_db_session_commits_before_the_response_starts(
    engine, verify_session: AsyncSession
) -> None:
    """A client that hears success must find the write committed."""
    inner = FastAPI()
    inner.state.sessionmaker = make_sessionmaker(engine)

    @inner.post("/write")
    async def write(session: DbSession) -> dict[str, bool]:
        session.add(User(clerk_user_id="user_committed_first"))
        return {"ok": True}

    seen_at_response_start: list[bool] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        async def watch(message: Message) -> None:
            if message["type"] == "http.response.start":
                async with AsyncSession(bind=engine) as s:
                    row = await s.scalar(
                        select(User).where(User.clerk_user_id == "user_committed_first")
                    )
                seen_at_response_start.append(row is not None)
            await send(message)

        await inner(scope, receive, watch)

    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as client:
        response = await client.post("/write")

    assert response.status_code == 200
    assert seen_at_response_start == [True]
