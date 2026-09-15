"""Profile endpoint and the Clerk account-deletion webhook."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import (
    datetime,
)
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 -- FastAPI resolves this annotation at route registration
)

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.auth.webhooks import verify_svix_signature
from crosstune.db.session import get_session
from crosstune.errors import UnauthorizedError
from crosstune.recordings.service import used_bytes
from crosstune.storage.store import user_prefix
from crosstune.users.service import delete_user_by_clerk_id

if TYPE_CHECKING:
    from crosstune.storage.store import ObjectStore

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["users"])


class StorageResponse(BaseModel):
    """How much of the recording quota is in use."""

    used_bytes: int
    quota_bytes: int
    max_file_bytes: int


class MeResponse(BaseModel):
    """The calling user's public profile."""

    id: uuid.UUID
    clerk_user_id: str
    email: str | None
    created_at: datetime
    storage: StorageResponse


@router.get("/me")
async def me(
    request: Request, user: CurrentUser, session: Annotated[AsyncSession, Depends(get_session)]
) -> MeResponse:
    """The calling user's profile and storage figures."""
    settings = request.app.state.settings
    return MeResponse(
        id=user.id,
        clerk_user_id=user.clerk_user_id,
        email=user.email,
        created_at=user.created_at,
        storage=StorageResponse(
            used_bytes=await used_bytes(session, user.id),
            quota_bytes=settings.recording_quota_bytes,
            max_file_bytes=settings.recording_max_file_bytes,
        ),
    )


async def _purge_user_files(store: ObjectStore, prefix: str) -> None:
    try:
        await store.delete_prefix(prefix)
    except Exception:
        log.warning("could not purge %s; the orphan sweep will remove it", prefix, exc_info=True)


@router.post("/webhooks/clerk", status_code=204, include_in_schema=False)
async def clerk_webhook(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    background: BackgroundTasks,
) -> Response:
    """Acknowledge every verified event. Only user.deleted changes state."""
    body = await request.body()
    secret = request.app.state.settings.clerk_webhook_secret
    if not secret or not verify_svix_signature(secret, request.headers, body):
        msg = "Invalid webhook signature"
        raise UnauthorizedError(msg)
    try:
        event = json.loads(body)
    except json.JSONDecodeError:
        return Response(status_code=204)
    # A signed-but-unprocessable body (not an object) can never turn into a delivery
    # we understand; acknowledge it so Clerk stops retrying.
    if not isinstance(event, dict):
        return Response(status_code=204)
    if event.get("type") == "user.deleted":
        clerk_user_id = (event.get("data") or {}).get("id")
        if clerk_user_id:
            user_id = await delete_user_by_clerk_id(session, clerk_user_id)
            store = request.app.state.object_store
            if user_id is not None and store is not None:
                # The row cascade cannot reach the bucket. The wipe runs after the
                # response so a slow or failing store never delays or rolls back the
                # deletion; the runner's orphan sweep removes whatever it misses.
                background.add_task(_purge_user_files, store, user_prefix(user_id))
    return Response(status_code=204)
