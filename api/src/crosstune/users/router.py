"""Profile endpoint and the Clerk account-deletion webhook."""

from __future__ import annotations

import json
import uuid
from datetime import (
    datetime,
)
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
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
from crosstune.users.service import delete_user_by_clerk_id

router = APIRouter(prefix="/v1", tags=["users"])


class MeResponse(BaseModel):
    """The calling user's public profile."""

    id: uuid.UUID
    clerk_user_id: str
    email: str | None
    created_at: datetime


@router.get("/me")
async def me(user: CurrentUser) -> MeResponse:
    """The calling user's profile."""
    return MeResponse(
        id=user.id, clerk_user_id=user.clerk_user_id, email=user.email, created_at=user.created_at
    )


@router.post("/webhooks/clerk", status_code=204, include_in_schema=False)
async def clerk_webhook(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)]
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
            await delete_user_by_clerk_id(session, clerk_user_id)
    return Response(status_code=204)
