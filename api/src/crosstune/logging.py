"""Process logging. JSON lines in production so Railway's log drain can index fields."""

from __future__ import annotations

import logging
import sys

from pythonjsonlogger.json import JsonFormatter

_HANDLER_NAME = "crosstune"
# Uvicorn installs plain handlers on these and stops propagation, which would keep its
# startup, error, and access lines out of the structured stream.
_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")


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
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    else:
        handler.setFormatter(JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
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
