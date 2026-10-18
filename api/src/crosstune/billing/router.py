"""Endpoints that refresh paid access from RevenueCat and withdraw from a web subscription."""

from __future__ import annotations

import hmac
import json
import logging
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, BackgroundTasks, Request, Response
from sqlalchemy import select

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.billing.notices import send_confirmations
from crosstune.billing.purchases import refresh_many_purchases, refresh_purchases
from crosstune.billing.revenuecat import RevenueCatUnavailableError
from crosstune.billing.withdrawal import withdraw
from crosstune.db.base import utc_now
from crosstune.db.session import (
    DbSession,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.errors import (
    BillingFailedError,
    BillingUnavailableError,
    TooManyRequestsError,
    UnauthorizedError,
    problem_responses,
)
from crosstune.models import User

if TYPE_CHECKING:
    import uuid
    from collections.abc import Sequence
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.config import Settings
    from crosstune.email.resend import Mailer

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["billing"])

_ID_FIELDS = ("app_user_id", "original_app_user_id")
_ID_LIST_FIELDS = ("aliases", "transferred_from", "transferred_to")


@router.post(
    "/me/billing/refresh", status_code=204, responses=problem_responses(401, 429, 502, 503)
)
async def refresh_billing(
    request: Request, user: CurrentUser, session: DbSession, background: BackgroundTasks
) -> Response:
    """Re-read the caller's subscriptions from RevenueCat and update their Premium access."""
    revenuecat = request.app.state.revenuecat
    if revenuecat is None:
        raise BillingUnavailableError
    # Each refresh spends RevenueCat requests from the limit the webhook also draws on.
    wait = request.app.state.billing_refresh_limiter.hit(user.id)
    if wait is not None:
        raise TooManyRequestsError(wait)
    now = utc_now()
    try:
        await refresh_purchases(session, user, revenuecat, request.app.state.settings, now)
    except RevenueCatUnavailableError as exc:
        raise BillingFailedError from exc
    _confirm_after_commit(request, background, [user.id], now)
    return Response(status_code=204)


@router.post(
    "/me/billing/withdraw", status_code=204, responses=problem_responses(401, 409, 429, 503)
)
async def withdraw_billing(request: Request, user: CurrentUser, session: DbSession) -> Response:
    """Refund the caller's web subscription in full and end Premium now.

    Allowed once per account, within 14 days of the subscription's first payment. A 409's
    `reason` says why a withdrawal was refused.
    """
    state = request.app.state
    if state.revenuecat is None or state.stripe is None:
        raise BillingUnavailableError
    # Each withdrawal spends RevenueCat requests from the limit the webhook also draws on.
    wait = state.billing_refresh_limiter.hit(user.id)
    if wait is not None:
        raise TooManyRequestsError(wait)
    await withdraw(
        session, user, state.stripe, state.revenuecat, state.mailer, state.settings, utc_now()
    )
    return Response(status_code=204)


def _customer_ids(event: dict[str, Any]) -> list[str]:
    ids: dict[str, None] = {}
    for field in _ID_FIELDS:
        value = event.get(field)
        if isinstance(value, str) and value:
            ids[value] = None
    for field in _ID_LIST_FIELDS:
        values = event.get(field)
        if isinstance(values, list):
            ids.update({v: None for v in values if isinstance(v, str) and v})
    return list(ids)


@router.post("/webhooks/revenuecat", include_in_schema=False)
async def revenuecat_webhook(
    request: Request, session: DbSession, background: BackgroundTasks
) -> Response:
    """Refresh every known user the event names.

    The payload is only a pointer to who changed: access always comes from asking
    RevenueCat again, never from the event's own fields.
    """
    settings = request.app.state.settings
    secret = settings.revenuecat_webhook_auth.get_secret_value()
    expected = f"Bearer {secret}".encode()
    given = request.headers.get("authorization", "").encode()
    if not secret or not hmac.compare_digest(given, expected):
        msg = "Invalid webhook authorization"
        raise UnauthorizedError(msg)
    revenuecat = request.app.state.revenuecat
    if revenuecat is None:
        # A 200 would make RevenueCat drop the event; a 503 makes it retry.
        raise BillingUnavailableError
    try:
        payload = json.loads(await request.body())
    except json.JSONDecodeError:
        return Response(status_code=200)
    event = payload.get("event") if isinstance(payload, dict) else None
    if not isinstance(event, dict):
        return Response(status_code=200)
    ids = _customer_ids(event)
    if not ids:
        return Response(status_code=200)
    users = (await session.scalars(select(User).where(User.clerk_user_id.in_(ids)))).all()
    now = utc_now()
    try:
        await refresh_many_purchases(session, users, revenuecat, settings, now)
    except RevenueCatUnavailableError as exc:
        raise BillingUnavailableError from exc
    _confirm_after_commit(request, background, [u.id for u in users], now)
    return Response(status_code=200)


def _confirm_after_commit(
    request: Request, background: BackgroundTasks, user_ids: Sequence[uuid.UUID], now: datetime
) -> None:
    """Send the users' owed purchase confirmations once the refresh has committed.

    A background task runs after the request's session commits, so the email never
    names a grant a rollback undid, and a slow or failed send never touches the response.
    """
    state = request.app.state
    if state.mailer is None or not user_ids:
        return
    background.add_task(
        _send_confirmations, state.sessionmaker, state.mailer, state.settings, list(user_ids), now
    )


async def _send_confirmations(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    settings: Settings,
    user_ids: list[uuid.UUID],
    now: datetime,
) -> None:
    try:
        await send_confirmations(sessionmaker, mailer, settings, user_ids, now)
    except Exception:
        # The daily billing-notices pass sends whatever this missed.
        log.exception("could not send purchase confirmations after a refresh")
