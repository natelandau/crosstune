"""Process logging. JSON lines in production so Railway's log drain can index fields."""

from __future__ import annotations

import logging
import re
import sys
from types import TracebackType

import httpx2
from pythonjsonlogger.json import JsonFormatter

_HANDLER_NAME = "crosstune"
# Uvicorn installs plain handlers on these and stops propagation, which would keep its
# startup, error, and access lines out of the structured stream.
_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")
_REQUEST_ARGS = 5
# Uvicorn's access record is (client, method, path, http_version, status); httpx2's
# outbound one is (method, url, http_version, status, reason).
_ACCESS_URL_INDEX = 2
_OUTBOUND_URL_INDEX = 1
# asyncpg quotes the start of a value it could not encode between the argument number and
# the reason: `invalid input for query argument $3: 'text...' (expected str, got int)`.
_DRIVER_VALUE = re.compile(
    r"(invalid input for query argument \$\d+[^:\n]*): .*?( \([^()\n]*\))?$", re.MULTILINE
)


_ExcInfo = tuple[type[BaseException], BaseException, TracebackType | None] | tuple[None, None, None]


def redact_driver_values(text: str) -> str:
    """Replace each value a database driver quoted in an error with a placeholder.

    Args:
        text: An error message or a formatted traceback.

    Returns:
        str: The text with the user's content gone and the argument and reason kept.
    """
    return _DRIVER_VALUE.sub(r"\1: <value redacted>\2", text)


class _RedactingFormatter(logging.Formatter):
    """A plain formatter whose tracebacks carry no value a driver quoted."""

    def formatException(self, ei: _ExcInfo) -> str:  # noqa: N802 -- overrides logging's name
        """Format the traceback, then redact it."""
        return redact_driver_values(super().formatException(ei))


class _RedactingJsonFormatter(JsonFormatter):
    """A JSON formatter whose tracebacks carry no value a driver quoted."""

    def formatException(self, ei: _ExcInfo) -> str | list[str]:  # noqa: N802 -- overrides logging's name
        """Format the traceback, then redact it."""
        formatted = super().formatException(ei)
        if isinstance(formatted, str):
            return redact_driver_values(formatted)
        return [redact_driver_values(line) for line in formatted]


class StripQueryFilter(logging.Filter):
    """Drop the query string from request lines, which can carry search text and coordinates."""

    def __init__(self, url_index: int) -> None:
        """Strip the argument at `url_index` of a five-argument request record."""
        super().__init__()
        self.url_index = url_index

    def filter(self, record: logging.LogRecord) -> bool:
        """Rewrite the URL argument in place and keep the record."""
        args = record.args
        i = self.url_index
        if isinstance(args, tuple) and len(args) == _REQUEST_ARGS:
            url = args[i]
            if isinstance(url, str | httpx2.URL):
                record.args = (*args[:i], str(url).split("?", 1)[0], *args[i + 1 :])
        return True


def configure_logging(*, debug: bool) -> None:
    """Install the process-wide log handler once; later calls in the same process are no-ops.

    `create_app` runs per test, and reinstalling the handler each time would
    stomp on other loggers' configuration for the rest of the process.
    """
    root = logging.getLogger()
    if any(handler.name == _HANDLER_NAME for handler in root.handlers):
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.name = _HANDLER_NAME
    if debug:
        handler.setFormatter(_RedactingFormatter("%(levelname)s %(name)s: %(message)s"))
    else:
        handler.setFormatter(
            _RedactingJsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
    root.handlers[:] = [handler]
    root.setLevel(logging.DEBUG if debug else logging.INFO)
    for name in _UVICORN_LOGGERS:
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
        # An earlier fileConfig or dictConfig in the process, an in-process alembic run
        # among them, leaves loggers it does not name disabled.
        logger.disabled = False
        # Unset, so these follow the root level rather than uvicorn's own.
        logger.setLevel(logging.NOTSET)
    logging.getLogger("uvicorn.access").addFilter(StripQueryFilter(_ACCESS_URL_INDEX))
    # A filter on the logger runs before Sentry turns the record into a breadcrumb.
    logging.getLogger("httpx2").addFilter(StripQueryFilter(_OUTBOUND_URL_INDEX))
