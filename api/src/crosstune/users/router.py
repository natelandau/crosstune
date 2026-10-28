"""Profile endpoint and the Clerk account-deletion webhook."""

from __future__ import annotations

import json
import logging
import uuid
from contextlib import nullcontext
from datetime import (
    datetime,
    timedelta,
)
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.auth.webhooks import verify_svix_signature
from crosstune.billing.access import access_for, refresh_entitlement
from crosstune.billing.closing import end_billing
from crosstune.db.base import bump_server_seq, utc_now
from crosstune.db.locks import billing_lock, lock_user
from crosstune.db.session import (
    DbSession,
    request_runner_wake,
)
from crosstune.errors import (
    VALIDATION_RESPONSE,
    AccountDeletionFailedError,
    AccountDeletionUnavailableError,
    BillingUnavailableError,
    UnauthorizedError,
    problem_responses,
)
from crosstune.files.quota import used_bytes
from crosstune.jobs.analytics import schedule_person_deletion
from crosstune.models import User
from crosstune.storage.store import user_prefix
from crosstune.users.apple import AppleClient, AppleRevokeError
from crosstune.users.clerk import ClerkUnavailableError
from crosstune.users.service import purge_account

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.storage.store import ObjectStore
    from crosstune.users.apple import AppleSignIn
    from crosstune.users.clerk import ClerkUsers

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
    access = await access_for(session, user.id, settings)
    return MeResponse(
        id=user.id,
        clerk_user_id=user.clerk_user_id,
        email=user.email,
        created_at=user.created_at,
        storage=StorageResponse(
            used_bytes=await used_bytes(session, user.id),
            quota_bytes=access.quota_bytes,
            max_file_bytes=settings.recording_max_file_bytes,
        ),
    )


Notice = Literal["first_recording", "trial_reminder", "trial_ended"]


class NoticeRequest(BaseModel):
    """A one-time notice the user has now seen."""

    notice: Notice


# Each notice's timestamp column on the entitlements row.
NOTICE_COLUMNS: dict[Notice, str] = {
    "first_recording": "recording_notice_seen_at",
    "trial_reminder": "trial_reminder_seen_at",
    "trial_ended": "trial_end_seen_at",
}


@router.post("/me/notices", status_code=204, responses=VALIDATION_RESPONSE)
async def record_notice(
    body: NoticeRequest, request: Request, user: CurrentUser, session: DbSession
) -> Response:
    """Record that the user saw a one-time notice, so no device shows it again.

    The first time is the one kept; a repeat changes nothing.
    """
    settings = request.app.state.settings
    # The row takes a new server_seq, which must commit in the order pull relies on.
    await lock_user(session, user.id, wait_seconds=settings.request_lock_timeout_seconds)
    row = await refresh_entitlement(session, user.id, settings)
    column = NOTICE_COLUMNS[body.notice]
    if getattr(row, column) is None:
        now = utc_now()
        setattr(row, column, now)
        row.updated_at = now
        bump_server_seq(row)
    return Response(status_code=204)


class DeleteMeRequest(BaseModel):
    """What the app may send with an account deletion."""

    apple_authorization_code: SecretStr | None = Field(default=None, min_length=1, max_length=512)
    apple_client: AppleClient = "app"


async def _purge_user_files(store: ObjectStore, prefix: str) -> None:
    try:
        await store.delete_prefix(prefix)
    except Exception:
        log.warning("could not purge %s; the orphan sweep will remove it", prefix, exc_info=True)


async def _revoke_apple(
    apple_sign_in: AppleSignIn,
    code: SecretStr,
    apple_user_ids: frozenset[str],
    client: AppleClient,
) -> None:
    # No exc_info: the traceback's locals would carry the authorization code.
    try:
        await apple_sign_in.revoke(code.get_secret_value(), apple_user_ids, client=client)
    except AppleRevokeError as error:
        log.error(  # noqa: TRY400
            "Sign in with Apple revoke failed",
            extra={"step": error.step, "apple_error": error.apple_error, "client": client},
        )
    except Exception:  # noqa: BLE001 -- nothing from the revoke may surface past the delete
        log.error(  # noqa: TRY400
            "Sign in with Apple revoke failed",
            extra={"step": "unexpected", "apple_error": None, "client": client},
        )


async def _apple_ids_to_revoke(
    clerk_users: ClerkUsers, apple_sign_in: AppleSignIn | None, clerk_user_id: str
) -> frozenset[str]:
    """Read the Apple account IDs a delete should revoke, read before Clerk's copy is gone.

    Returns:
        frozenset[str]: The IDs, empty when revocation is off or nothing can be revoked.
    """
    if apple_sign_in is None:
        log.info("Sign in with Apple revocation is off; skipping the revoke")
        return frozenset()
    try:
        apple_ids = await clerk_users.apple_user_ids(clerk_user_id)
    except ClerkUnavailableError:
        log.error(  # noqa: TRY400 -- the exception adds nothing beyond the step
            "could not read the Apple accounts to revoke; skipping the revoke",
            extra={"step": "lookup"},
        )
        return frozenset()
    if not apple_ids:
        log.info("no Apple account to revoke; skipping the revoke")
    return apple_ids


@router.delete("/me", status_code=204, responses=problem_responses(401, 502, 503))
async def delete_me(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    background: BackgroundTasks,
    body: DeleteMeRequest | None = None,
) -> Response:
    """Delete the calling user's account, every row it owns, and Clerk's copy.

    Files are removed after the response. With an Apple authorization code, the
    Sign in with Apple authorization is also revoked after the response, once Clerk's
    copy is gone; a failed revoke is logged and never blocks the deletion.
    """
    clerk_users = request.app.state.clerk_users
    if clerk_users is None:
        raise AccountDeletionUnavailableError
    apple_sign_in = request.app.state.apple_sign_in
    # Kept as a SecretStr so the code never sits in a plain local that Sentry could capture.
    code = body.apple_authorization_code if body is not None else None
    apple_client: AppleClient = body.apple_client if body is not None else "app"
    apple_ids = (
        await _apple_ids_to_revoke(clerk_users, apple_sign_in, user.clerk_user_id)
        if code is not None
        else frozenset()
    )
    # The billing lock keeps a withdrawal, the withdrawal pass, and a second deletion out
    # from the first billing step until the purge is written.
    wait_seconds = request.app.state.settings.request_lock_timeout_seconds
    async with billing_lock(session, user.id, wait_seconds=wait_seconds):
        await lock_user(session, user.id, wait_seconds=wait_seconds)
        refund_notice = await end_billing(
            session,
            user,
            request.app.state.stripe,
            request.app.state.revenuecat,
            request.app.state.settings,
            utc_now(),
            request.app.state.mailer,
        )
        user_id = await purge_account(session, user.clerk_user_id)
        if user_id is not None:
            try:
                await clerk_users.delete_user(user.clerk_user_id)
            except ClerkUnavailableError as exc:
                raise AccountDeletionFailedError from exc
    # A missing row means a concurrent delete already committed, and both delete paths
    # commit only once Clerk's copy is gone, so this request's code still revokes.
    # After the response, so Apple's latency never holds the user lock or the transaction.
    if code is not None and apple_ids:
        background.add_task(_revoke_apple, apple_sign_in, code, apple_ids, apple_client)
    if user_id is None:
        return Response(status_code=204)
    if refund_notice is not None:
        background.add_task(_send_refund_notice, request.app.state.sessionmaker, refund_notice)
    store = request.app.state.object_store
    if store is not None:
        background.add_task(_purge_user_files, store, user_prefix(user_id))
    return Response(status_code=204)


async def _send_refund_notice(
    sessionmaker: async_sessionmaker[AsyncSession],
    send: Callable[[AsyncSession], Awaitable[None]],
) -> None:
    async with sessionmaker() as session:
        await send(session)


async def _end_billing_for_webhook(
    request: Request, session: AsyncSession, user: User
) -> Callable[[AsyncSession], Awaitable[None]] | None:
    try:
        return await end_billing(
            session,
            user,
            request.app.state.stripe,
            request.app.state.revenuecat,
            request.app.state.settings,
            utc_now(),
            request.app.state.mailer,
        )
    except (AccountDeletionUnavailableError, AccountDeletionFailedError):
        # Svix retries a 503; the purge has not run, so the retry starts clean.
        msg = "Could not end billing for the deleted account"
        raise BillingUnavailableError(msg) from None


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
            existing = await session.scalar(select(User).where(User.clerk_user_id == clerk_user_id))
            refund_notice = None
            held = billing_lock(session, existing.id) if existing is not None else nullcontext()
            async with held:
                if existing is not None:
                    await lock_user(session, existing.id)
                    refund_notice = await _end_billing_for_webhook(request, session, existing)
                user_id = await purge_account(session, clerk_user_id)
            if user_id is not None and refund_notice is not None:
                background.add_task(
                    _send_refund_notice, request.app.state.sessionmaker, refund_notice
                )
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
