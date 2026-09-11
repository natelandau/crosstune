"""Typed errors that render as RFC 9457 problem details."""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING, Any

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException

if TYPE_CHECKING:
    from collections.abc import Mapping

    from fastapi import FastAPI, Request

PROBLEM_JSON = "application/problem+json"


class Problem(BaseModel):
    """An RFC 9457 problem details body, the shape of every error this API returns."""

    type: str = "about:blank"
    title: str
    status: int
    detail: str
    errors: list[dict[str, Any]] | None = None


# Routes that validate input answer 422 with a problem, not FastAPI's own envelope.
VALIDATION_RESPONSE: dict[int | str, dict[str, Any]] = {
    422: {"model": Problem, "description": "Validation Error"}
}


class AppError(Exception):
    """An error with an HTTP status and a human-readable detail."""

    def __init__(self, status: int, title: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.title = title
        self.detail = detail


class UnauthorizedError(AppError):
    """Missing or invalid credentials."""

    def __init__(self, detail: str = "Missing or invalid credentials") -> None:
        super().__init__(401, "Unauthorized", detail)


class ForbiddenError(AppError):
    """The caller is authenticated but not allowed to do this."""

    def __init__(self, detail: str = "Not allowed") -> None:
        super().__init__(403, "Forbidden", detail)


class NotFoundError(AppError):
    """The requested resource does not exist."""

    def __init__(self, detail: str = "Not found") -> None:
        super().__init__(404, "Not Found", detail)


def _problem(
    status: int,
    title: str,
    detail: str,
    *,
    headers: Mapping[str, str] | None = None,
    extra: Mapping[str, Any] | None = None,
) -> JSONResponse:
    content: dict[str, Any] = {
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
    }
    content.update(extra or {})
    return JSONResponse(
        status_code=status, content=content, media_type=PROBLEM_JSON, headers=dict(headers or {})
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
                content = operation.get("responses", {}).get("422", {}).get("content", {})
                if "application/json" in content:
                    content[PROBLEM_JSON] = content.pop("application/json")
        return schema

    # Replacing the generator on the instance is FastAPI's documented extension point.
    app.openapi = openapi  # ty: ignore[invalid-assignment]


def install_error_handlers(app: FastAPI) -> None:
    """Render AppError, HTTP exceptions, and request validation failures as problem details."""
    _publish_problem_media_type(app)

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return _problem(exc.status, exc.title, exc.detail)

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
