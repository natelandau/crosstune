"""Endpoints that refresh paid access from RevenueCat."""

from __future__ import annotations

import hmac
import json
from typing import Any

from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.billing.purchases import refresh_many_purchases, refresh_purchases
from crosstune.billing.revenuecat import RevenueCatUnavailableError
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

router = APIRouter(prefix="/v1", tags=["billing"])

_ID_FIELDS = ("app_user_id", "original_app_user_id")
_ID_LIST_FIELDS = ("aliases", "transferred_from", "transferred_to")


@router.post(
    "/me/billing/refresh", status_code=204, responses=problem_responses(401, 429, 502, 503)
)
async def refresh_billing(request: Request, user: CurrentUser, session: DbSession) -> Response:
    """Re-read the caller's subscriptions from RevenueCat and update their Premium access."""
    revenuecat = request.app.state.revenuecat
    if revenuecat is None:
        raise BillingUnavailableError
    # Each refresh spends RevenueCat requests from the limit the webhook also draws on.
    wait = request.app.state.billing_refresh_limiter.hit(user.id)
    if wait is not None:
        raise TooManyRequestsError(wait)
    try:
        await refresh_purchases(session, user, revenuecat, request.app.state.settings, utc_now())
    except RevenueCatUnavailableError as exc:
        raise BillingFailedError from exc
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
async def revenuecat_webhook(request: Request, session: DbSession) -> Response:
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
    return Response(status_code=200)
