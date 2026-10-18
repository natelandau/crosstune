"""Country of a request, from a header the edge sets or a local IP database."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Protocol

import maxminddb

if TYPE_CHECKING:
    from pathlib import Path

    from fastapi import Request

logger = logging.getLogger(__name__)

COUNTRY_HEADER = "x-crosstune-country"


class CountryReader(Protocol):
    """Maps an IP address to a country code."""

    def country(self, ip: str) -> str | None:
        """The ISO country code for `ip`, or None when unknown."""


class MaxMindCountryReader:
    """Reads the country from a MaxMind-format database such as DB-IP Lite."""

    def __init__(self, path: Path) -> None:
        self._database = maxminddb.open_database(str(path))

    def country(self, ip: str) -> str | None:
        """The ISO country code for `ip`, or None when the database has none."""
        try:
            record = self._database.get(ip)
        except (ValueError, OSError, maxminddb.InvalidDatabaseError):
            return None
        if not isinstance(record, dict):
            return None
        country = record.get("country")
        if not isinstance(country, dict):
            return None
        code = country.get("iso_code")
        return code if isinstance(code, str) else None


class NoCountryReader:
    """Stands in when no database is available."""

    def country(self, ip: str) -> str | None:  # noqa: ARG002
        """Always None."""
        return None


def load_reader(path: Path) -> CountryReader:
    """Open the database at `path`, or fall back to a reader that knows nothing."""
    try:
        return MaxMindCountryReader(path)
    except (OSError, ValueError, maxminddb.InvalidDatabaseError):
        logger.warning("IP country database unavailable at %s; countries stay unset", path)
        return NoCountryReader()


def normalize(code: str | None) -> str | None:
    """Uppercase a two-letter country code; unknown markers and anything else become None."""
    if code is None:
        return None
    code = code.strip().upper()
    if len(code) != 2 or not code.isalpha() or code in {"XX", "T1"}:  # noqa: PLR2004
        return None
    return code


def client_ip(request: Request) -> str | None:
    """The caller's address from the proxy headers, else None."""
    real = request.headers.get("x-real-ip", "").strip()
    if real:
        return real
    first = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return first or None


def request_country(request: Request) -> str | None:
    """The request's country: the edge header, else a lookup of the caller's IP."""
    from_header = normalize(request.headers.get(COUNTRY_HEADER))
    if from_header is not None:
        return from_header
    ip = client_ip(request)
    if ip is None:
        return None
    return normalize(request.app.state.geo.country(ip))
