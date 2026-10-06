"""Typed errors that render as RFC 9457 problem details."""

from __future__ import annotations

import math
from http import HTTPStatus
from typing import TYPE_CHECKING, Any

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException

if TYPE_CHECKING:
    from collections.abc import Mapping

    from fastapi import FastAPI, Request

PROBLEM_JSON = "application/problem+json"
ACCOUNT_DELETED_PROBLEM = "urn:crosstune:account-deleted"


class Problem(BaseModel):
    """An RFC 9457 problem details body, the shape of every error this API returns."""

    type: str = Field(
        default="about:blank",
        description=(
            "`about:blank`, or a problem a client branches on: "
            "`urn:crosstune:account-deleted` (401, the account was deleted, so the "
            "client drops its local data), `urn:crosstune:quota-exceeded` (413), "
            "`urn:crosstune:file-too-large` (413)."
        ),
    )
    title: str
    status: int
    detail: str
    errors: list[dict[str, Any]] | None = None


# Every 429 this API sends names its wait. The header is optional text in the contract, so a
# generated client still decodes a 429 from a proxy that omits it or sends an HTTP date.
RETRY_AFTER_HEADER: dict[str, Any] = {
    "Retry-After": {
        "description": "Whole seconds to wait before trying again.",
        "required": False,
        "schema": {"type": "string"},
    }
}

type OpenApiResponses = dict[int | str, dict[str, Any]]

# Routes that validate input answer 422 with a problem, not FastAPI's own envelope.
VALIDATION_RESPONSE: OpenApiResponses = {422: {"model": Problem, "description": "Validation Error"}}


def problem_responses(*statuses: int) -> OpenApiResponses:
    """Document the problem details a route answers with, alongside the 422 every route has.

    Args:
        statuses: The HTTP statuses the route can fail with.

    Returns:
        OpenApiResponses: OpenAPI responses, so the generated
        client has a type for each state it must branch on.
    """
    documented: OpenApiResponses = {
        status: {"model": Problem, "description": _reason_phrase(status)} for status in statuses
    }
    if HTTPStatus.TOO_MANY_REQUESTS in documented:
        documented[HTTPStatus.TOO_MANY_REQUESTS]["headers"] = RETRY_AFTER_HEADER
    return documented | VALIDATION_RESPONSE


class AppError(Exception):
    """An error with an HTTP status and a human-readable detail."""

    def __init__(
        self,
        status: int,
        title: str,
        detail: str,
        *,
        type_: str = "about:blank",
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(detail)
        self.status = status
        self.title = title
        self.detail = detail
        self.type = type_
        self.headers = headers


class UnauthorizedError(AppError):
    """Missing or invalid credentials."""

    def __init__(self, detail: str = "Missing or invalid credentials") -> None:
        super().__init__(401, "Unauthorized", detail)


class AccountDeletedError(UnauthorizedError):
    """The token belongs to a deleted account, so the client must drop its local copy."""

    def __init__(self) -> None:
        AppError.__init__(
            self, 401, "Unauthorized", "This account was deleted", type_=ACCOUNT_DELETED_PROBLEM
        )


class ForbiddenError(AppError):
    """The caller is authenticated but not allowed to do this."""

    def __init__(self, detail: str = "Not allowed") -> None:
        super().__init__(403, "Forbidden", detail)


class NotFoundError(AppError):
    """The requested resource does not exist."""

    def __init__(self, detail: str = "Not found") -> None:
        super().__init__(404, "Not Found", detail)


class ConflictError(AppError):
    """The resource is not in a state that allows this."""

    def __init__(self, detail: str = "Conflict") -> None:
        super().__init__(409, "Conflict", detail)


class QuotaExceededError(AppError):
    """The upload would take the caller past their storage quota."""

    def __init__(self, detail: str = "Storage quota exceeded") -> None:
        super().__init__(413, "Content Too Large", detail, type_="urn:crosstune:quota-exceeded")


class FileTooLargeError(AppError):
    """One file is over the per-file cap."""

    def __init__(self, detail: str = "File is too large") -> None:
        super().__init__(413, "Content Too Large", detail, type_="urn:crosstune:file-too-large")


class ServiceUnavailableError(AppError):
    """A service the request depends on is down or not configured; trying later may work."""

    def __init__(self, detail: str) -> None:
        super().__init__(503, "Service Unavailable", detail)


class TooManyRequestsError(AppError):
    """The caller has used up a rate limit and must wait before trying again."""

    def __init__(self, retry_after_seconds: float, detail: str = "Too many requests") -> None:
        super().__init__(
            429,
            "Too Many Requests",
            detail,
            headers={"Retry-After": str(max(1, math.ceil(retry_after_seconds)))},
        )


def _problem(
    status: int,
    title: str,
    detail: str,
    *,
    type_: str = "about:blank",
    headers: Mapping[str, str] | None = None,
    extra: Mapping[str, Any] | None = None,
) -> JSONResponse:
    content: dict[str, Any] = {"type": type_, "title": title, "status": status, "detail": detail}
    content.update(extra or {})
    return JSONResponse(
        status_code=status, content=content, media_type=PROBLEM_JSON, headers=dict(headers or {})
    )


def problem_response(error: AppError) -> JSONResponse:
    """Render an AppError as its problem document, for code that runs outside a route.

    Args:
        error: The error to render.

    Returns:
        JSONResponse: The response an exception handler would have sent.
    """
    return _problem(
        error.status, error.title, error.detail, type_=error.type, headers=error.headers
    )


def _reason_phrase(status: int) -> str:
    try:
        return HTTPStatus(status).phrase
    except ValueError:
        return "Error"


def _publish_problem_media_type(app: FastAPI) -> None:
    """Document every problem response under the media type it is actually sent with.

    FastAPI takes an additional response's media type from the route's response class,
    which is JSON, and the only declaration that registers the model in `components`
    is the one that hard-codes that media type. Rewriting the generated document is
    what is left. The generator caches its result, so this runs once per app.
    """
    generate = app.openapi

    def openapi() -> dict[str, Any]:
        schema = generate()
        for path_item in schema.get("paths", {}).values():
            for operation in path_item.values():
                for response in operation.get("responses", {}).values():
                    content = response.get("content", {})
                    body = content.get("application/json", {})
                    if str(body.get("schema", {}).get("$ref", "")).endswith("/Problem"):
                        content[PROBLEM_JSON] = content.pop("application/json")
        return schema

    # Replacing the generator on the instance is FastAPI's documented extension point.
    app.openapi = openapi  # ty: ignore[invalid-assignment]


def install_error_handlers(app: FastAPI) -> None:
    """Render AppError, HTTP exceptions, and request validation failures as problem details."""
    _publish_problem_media_type(app)

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return problem_response(exc)

    @app.exception_handler(HTTPException)
    async def _http_exception(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else _reason_phrase(exc.status_code)
        return _problem(
            exc.status_code, _reason_phrase(exc.status_code), detail, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # RFC 9457 detail is a string; the per-field failures ride in an extension member.
        return _problem(
            422,
            "Unprocessable Content",
            "Request validation failed",
            extra={"errors": jsonable_encoder(exc.errors())},
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, _exc: Exception) -> JSONResponse:
        # ServerErrorMiddleware sends this response, then re-raises the original
        # exception so Sentry's ASGI integration still captures it. No exception
        # detail is exposed to the caller.
        return _problem(500, "Internal Server Error", "An unexpected error occurred")
