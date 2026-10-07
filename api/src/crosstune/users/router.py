"""Profile endpoint and the Clerk account-deletion webhook."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import (
    datetime,
    timedelta,
)
from typing import TYPE_CHECKING

from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.auth.webhooks import verify_svix_signature
from crosstune.db.locks import lock_user
from crosstune.db.session import (
    DbSession,
    request_runner_wake,
)
from crosstune.errors import AppError, UnauthorizedError, problem_responses
from crosstune.files.quota import used_bytes
from crosstune.jobs.analytics import schedule_person_deletion
from crosstune.storage.store import user_prefix
from crosstune.users.clerk import ClerkUnavailableError
from crosstune.users.service import purge_account

if TYPE_CHECKING:
    from crosstune.storage.store import ObjectStore

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["users"])


class StorageResponse(BaseModel):
    """How much of the storage quota is in use."""

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
async def me(request: Request, user: CurrentUser, session: DbSession) -> MeResponse:
    """The calling user's profile and storage figures."""
    settings = request.app.state.settings
    return MeResponse(
        id=user.id,
        clerk_user_id=user.clerk_user_id,
        email=user.email,
        created_at=user.created_at,
        storage=StorageResponse(
            used_bytes=await used_bytes(session, user.id),
            quota_bytes=settings.storage_quota_bytes,
            max_file_bytes=settings.recording_max_file_bytes,
        ),
    )


async def _purge_user_files(store: ObjectStore, prefix: str) -> None:
    try:
        await store.delete_prefix(prefix)
    except Exception:
        log.warning("could not purge %s; the orphan sweep will remove it", prefix, exc_info=True)


class AccountDeletionUnavailableError(AppError):
    """No Clerk client is configured, so an account cannot be deleted."""

    def __init__(self) -> None:
        super().__init__(503, "Service Unavailable", "Account deletion is not configured")


class AccountDeletionFailedError(AppError):
    """Clerk did not confirm the delete. The transaction that removed the row rolls back."""

    def __init__(self) -> None:
        super().__init__(502, "Bad Gateway", "Could not delete the Clerk account")


@router.delete("/me", status_code=204, responses=problem_responses(401, 502, 503))
async def delete_me(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    background: BackgroundTasks,
) -> Response:
    """Delete the calling user's account, every row it owns, and Clerk's copy.

    Files are removed after the response.
    """
    clerk_users = request.app.state.clerk_users
    if clerk_users is None:
        raise AccountDeletionUnavailableError
    await lock_user(session, user.id)
    user_id = await purge_account(session, user.clerk_user_id)
    if user_id is None:
        # A concurrent delete for this user already committed; there is nothing left to remove.
        return Response(status_code=204)
    try:
        await clerk_users.delete_user(user.clerk_user_id)
    except ClerkUnavailableError as exc:
        raise AccountDeletionFailedError from exc
    store = request.app.state.object_store
    if store is not None:
        background.add_task(_purge_user_files, store, user_prefix(user_id))
    return Response(status_code=204)


@router.post("/webhooks/clerk", status_code=204, include_in_schema=False)
async def clerk_webhook(
    request: Request,
    session: DbSession,
    background: BackgroundTasks,
) -> Response:
    """Acknowledge every verified event. Only user.deleted changes state."""
    body = await request.body()
    secret = request.app.state.settings.clerk_webhook_secret
    if not secret or not verify_svix_signature(secret.get_secret_value(), request.headers, body):
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
    data = event.get("data")
    if event.get("type") == "user.deleted" and isinstance(data, dict):
        clerk_user_id = data.get("id")
        if isinstance(clerk_user_id, str) and clerk_user_id:
            user_id = await purge_account(session, clerk_user_id)
            store = request.app.state.object_store
            if user_id is not None and store is not None:
                # The row cascade cannot reach the bucket. The wipe runs after the
                # response so a slow or failing store never delays or rolls back the
                # deletion; the runner's orphan sweep removes whatever it misses.
                background.add_task(_purge_user_files, store, user_prefix(user_id))
            # Events can exist without a local row, so this runs even when nothing was purged.
            # The runner owns the deletes, so PostHog failing never delays or rolls back this.
            if request.app.state.analytics_persons is not None:
                settings = request.app.state.settings
                schedule_person_deletion(
                    session,
                    clerk_user_id,
                    later_passes_after=[
                        timedelta(seconds=seconds)
                        for seconds in (
                            settings.posthog_second_delete_seconds,
                            settings.posthog_third_delete_seconds,
                            settings.posthog_fourth_delete_seconds,
                        )
                    ],
                )
                request_runner_wake(session)
    return Response(status_code=204)
