"""Every logger in the process reaches the one structured handler."""

from __future__ import annotations

import io
import json
import logging

import pytest

from crosstune.logging import configure_logging


@pytest.fixture
def fresh_logging():
    """Undo the process-wide logging configuration the test installs."""
    root = logging.getLogger()
    access = logging.getLogger("uvicorn.access")
    saved = (root.handlers[:], root.level, access.handlers[:], access.propagate, access.level)
    root.handlers[:] = []
    yield root, access
    root.handlers[:], root.level, access.handlers[:], access.propagate, access.level = saved


def test_uvicorn_access_logs_reach_the_json_handler(fresh_logging) -> None:
    root, access = fresh_logging
    configure_logging(debug=False)

    assert access.propagate is True
    assert access.handlers == []

    stream = io.StringIO()
    root.handlers[0].stream = stream
    access.info('GET /v1/me HTTP/1.1" 200')

    assert json.loads(stream.getvalue())["message"] == 'GET /v1/me HTTP/1.1" 200'
