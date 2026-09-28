"""Per-request session dependency commits on success and rolls back on error."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx2
import pytest
from fastapi import Depends, FastAPI
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.engine import make_sessionmaker
from crosstune.db.session import DbSession, get_session, request_runner_wake
from crosstune.models import User
from tests.fakes import FakeRunner

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


def _marking_app(engine, runner: FakeRunner | None, seen: list[AsyncSession]) -> FastAPI:
    app = FastAPI()
    app.state.sessionmaker = make_sessionmaker(engine)
    app.state.job_runner = runner

    @app.post("/queue")
    async def queue(session: DbSession) -> dict[str, bool]:
        session.add(User(clerk_user_id="user_queued"))
        await session.flush()
        request_runner_wake(session)
        seen.append(session)
        return {"ok": True}

    @app.post("/queue-then-fail")
    async def queue_then_fail(session: DbSession) -> None:
        request_runner_wake(session)
        msg = "boom"
        raise ValueError(msg)

    return app


async def test_get_session_wakes_the_runner_after_commit(
    engine, verify_session: AsyncSession
) -> None:
    """The runner must never look for a job the request has not committed yet."""
    seen: list[AsyncSession] = []
    open_at_wake: list[bool] = []
    runner = FakeRunner(on_wake=lambda: open_at_wake.append(seen[0].in_transaction()))
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=_marking_app(engine, runner, seen)),
        base_url="http://testclient",
    ) as client:
        response = await client.post("/queue")

    assert response.status_code == 200
    assert runner.wakes == 1
    assert open_at_wake == [False]
    written = await verify_session.scalar(select(User).where(User.clerk_user_id == "user_queued"))
    assert written is not None
    await verify_session.delete(written)
    await verify_session.commit()


async def test_get_session_does_not_wake_on_error(engine) -> None:
    runner = FakeRunner()
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=_marking_app(engine, runner, [])),
        base_url="http://testclient",
    ) as client:
        with pytest.raises(ValueError, match="boom"):
            await client.post("/queue-then-fail")
    assert runner.wakes == 0


async def test_get_session_without_a_runner_is_fine(engine) -> None:
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=_marking_app(engine, None, [])),
        base_url="http://testclient",
    ) as client:
        response = await client.post("/queue")
    assert response.status_code == 200
    async with engine.begin() as conn:
        await conn.execute(delete(User).where(User.clerk_user_id == "user_queued"))
