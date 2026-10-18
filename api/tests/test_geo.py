"""Country resolution from the edge header or the IP database."""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING

import maxminddb
import pytest
from starlette.requests import Request

from crosstune.geo import (
    MaxMindCountryReader,
    NoCountryReader,
    client_ip,
    load_reader,
    normalize,
    request_country,
)

if TYPE_CHECKING:
    from pathlib import Path


class FixedReader:
    """Answers every lookup with one code."""

    def __init__(self, code: str | None) -> None:
        self.code = code
        self.asked: list[str] = []

    def country(self, ip: str) -> str | None:
        self.asked.append(ip)
        return self.code


def make_request(headers: dict[str, str], reader) -> Request:
    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "app": SimpleNamespace(state=SimpleNamespace(geo=reader)),
    }
    return Request(scope)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("de", "DE"),
        ("DE", "DE"),
        ("XX", None),
        ("T1", None),
        ("", None),
        (None, None),
        ("DEU", None),
    ],
)
def test_normalize(raw, expected) -> None:
    assert normalize(raw) == expected


def test_client_ip_prefers_real_ip() -> None:
    request = make_request({"X-Real-IP": "1.1.1.1", "X-Forwarded-For": "2.2.2.2"}, None)
    assert client_ip(request) == "1.1.1.1"


def test_client_ip_uses_first_forwarded_entry() -> None:
    request = make_request({"X-Forwarded-For": "2.2.2.2, 3.3.3.3"}, None)
    assert client_ip(request) == "2.2.2.2"


def test_client_ip_none_without_headers() -> None:
    assert client_ip(make_request({}, None)) is None


def test_request_country_prefers_header() -> None:
    reader = FixedReader("FR")
    request = make_request({"X-Crosstune-Country": "de", "X-Real-IP": "1.1.1.1"}, reader)
    assert request_country(request) == "DE"
    assert reader.asked == []


def test_request_country_falls_back_to_reader() -> None:
    reader = FixedReader("fr")
    request = make_request({"X-Real-IP": "1.1.1.1"}, reader)
    assert request_country(request) == "FR"
    assert reader.asked == ["1.1.1.1"]


def test_request_country_ignores_an_unusable_header() -> None:
    request = make_request({"X-Crosstune-Country": "XX", "X-Real-IP": "1.1.1.1"}, FixedReader("FR"))
    assert request_country(request) == "FR"


def test_request_country_none_without_ip_or_database() -> None:
    assert request_country(make_request({"X-Real-IP": "1.1.1.1"}, NoCountryReader())) is None
    assert request_country(make_request({}, FixedReader("FR"))) is None


def test_load_reader_missing_path_gives_no_country(tmp_path: Path) -> None:
    reader = load_reader(tmp_path / "absent.mmdb")
    assert isinstance(reader, NoCountryReader)
    assert reader.country("1.1.1.1") is None


def test_load_reader_corrupt_file_gives_no_country(tmp_path: Path) -> None:
    path = tmp_path / "bad.mmdb"
    path.write_bytes(b"not a database")
    assert isinstance(load_reader(path), NoCountryReader)


@pytest.mark.parametrize("error", [maxminddb.InvalidDatabaseError("corrupt"), OSError("gone")])
def test_reader_lookup_failure_gives_no_country(error) -> None:
    class BrokenDatabase:
        def get(self, ip: str) -> None:
            raise error

    reader = MaxMindCountryReader.__new__(MaxMindCountryReader)
    reader._database = BrokenDatabase()
    assert reader.country("1.1.1.1") is None
