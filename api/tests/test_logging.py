"""Every logger in the process reaches the one structured handler."""

from __future__ import annotations

import io
import json
import logging
import uuid
from typing import TYPE_CHECKING, cast

import httpx2
import pytest

from crosstune.jobs.attempt import retry_or_drop
from crosstune.logging import configure_logging
from crosstune.models import Job

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@pytest.fixture
def fresh_logging():
    """Undo the process-wide logging configuration the test installs."""
    root = logging.getLogger()
    access = logging.getLogger("uvicorn.access")
    outbound = logging.getLogger("httpx2")
    saved = (root.handlers[:], root.level, access.handlers[:], access.propagate, access.level)
    saved_filters = (access.filters[:], outbound.filters[:])
    root.handlers[:] = []
    yield root, access
    root.handlers[:], root.level, access.handlers[:], access.propagate, access.level = saved
    access.filters[:], outbound.filters[:] = saved_filters


def test_uvicorn_access_logs_reach_the_json_handler(fresh_logging) -> None:
    root, access = fresh_logging
    configure_logging(debug=False)

    assert access.propagate is True
    assert access.handlers == []

    stream = io.StringIO()
    root.handlers[0].stream = stream
    access.info('GET /v1/me HTTP/1.1" 200')

    assert json.loads(stream.getvalue())["message"] == 'GET /v1/me HTTP/1.1" 200'


def test_access_logs_drop_the_query_string(fresh_logging) -> None:
    root, access = fresh_logging
    configure_logging(debug=False)
    stream = io.StringIO()
    root.handlers[0].stream = stream
    access.info(
        '%s - "%s %s HTTP/%s" %d',
        "1.2.3.4:5",
        "GET",
        "/v1/links/search?q=silver+spear",
        "1.1",
        200,
    )
    message = json.loads(stream.getvalue())["message"]
    assert "silver" not in message
    assert '"GET /v1/links/search HTTP/1.1" 200' in message


def test_access_logs_with_another_shape_pass_through(fresh_logging) -> None:
    root, access = fresh_logging
    configure_logging(debug=False)
    stream = io.StringIO()
    root.handlers[0].stream = stream
    access.info("plain %s?x", "text")
    assert json.loads(stream.getvalue())["message"] == "plain text?x"


def test_outbound_request_logs_drop_the_query_string(fresh_logging) -> None:
    root, _ = fresh_logging
    configure_logging(debug=False)
    stream = io.StringIO()
    root.handlers[0].stream = stream
    logging.getLogger("httpx2").info(
        'HTTP Request: %s %s "%s %d %s"',
        "GET",
        httpx2.URL("https://maps-api.apple.com/v1/reverseGeocode?loc=36.66,-80.92"),
        "HTTP/1.1",
        200,
        "OK",
    )
    message = json.loads(stream.getvalue())["message"]
    assert "36.66" not in message
    assert "GET https://maps-api.apple.com/v1/reverseGeocode " in message


_DRIVER_ERROR = (
    "invalid input for query argument $3: 'Learned in Joe (the barn)...' (expected str, got int)"
)


@pytest.mark.parametrize("debug", [False, True])
def test_logged_tracebacks_drop_the_value_a_driver_quoted(fresh_logging, *, debug: bool) -> None:
    root, _ = fresh_logging
    configure_logging(debug=debug)
    stream = io.StringIO()
    root.handlers[0].stream = stream

    def write() -> None:
        raise ValueError(_DRIVER_ERROR)

    try:
        write()
    except ValueError:
        logging.getLogger("crosstune.test").exception("write failed")

    logged = stream.getvalue()
    assert "Joe" not in logged
    assert "invalid input for query argument $3: <value redacted> (expected str, got int)" in logged


@pytest.mark.anyio
async def test_a_failed_job_keeps_no_value_a_driver_quoted(
    caplog: pytest.LogCaptureFixture,
) -> None:
    job = Job(recording_id=uuid.uuid4(), user_id=uuid.uuid4(), kind="peaks", attempts=1)

    with caplog.at_level(logging.WARNING, logger="crosstune.jobs.attempt"):
        dropped = await retry_or_drop(cast("AsyncSession", None), job, ValueError(_DRIVER_ERROR))

    assert dropped is False
    assert job.last_error is not None
    assert "Joe" not in job.last_error
    [failed] = [r for r in caplog.records if r.getMessage() == "job failed"]
    assert "Joe" not in failed.error
