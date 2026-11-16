"""Sentry is initialized only with a DSN and always tagged with the environment."""

import json
import sys

import httpx2
import pytest
import sentry_sdk
from pydantic import BaseModel, ValidationError
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.billing import withdrawal
from crosstune.billing.emails import withdrawal_email
from crosstune.config import Settings
from crosstune.db.engine import make_engine
from crosstune.error_reports import before_send, redacted_repr
from crosstune.jobs.media import MediaError, Probe, run_media_tool
from crosstune.links.resolve import ResolvedLink
from crosstune.links.router import SearchResult
from crosstune.main import create_app
from crosstune.places.budget import DailyLimits
from crosstune.places.maps import PlaceHit
from crosstune.sync.rules import RecordingRules
from tests.fakes import FakeMailer
from tests.helpers import OEMBED, T1, change, push, recording, uid

DSN = "https://key@o1.ingest.sentry.io/1"
# Kept out of the test body, whose source lines a report carries as context.
_UNKNOWN_PROVIDER_HIT = {
    "url": "https://youtu.be/dQw4w9WgXcQ",
    "provider": "Sally Ann from Kyle Creed",
    "provider_ref": None,
    "title": "Sally Ann",
    "subtitle": None,
    "artwork_url": None,
}


def test_sentry_is_tagged_with_the_environment(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN, environment="production"))
    init.assert_called_once()
    assert init.call_args.kwargs["environment"] == "production"
    assert init.call_args.kwargs["dsn"] == DSN


def test_sentry_scrubs_email_fields_at_any_depth(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN))
    scrubber = init.call_args.kwargs["event_scrubber"]
    frame = {"vars": {"email": "a@example.com", "user": {"email": "b@example.com"}}}
    event = {"exception": {"values": [{"stacktrace": {"frames": [frame]}}]}}
    scrubber.scrub_event(event)
    assert "example.com" not in str(event)
    assert "password" in scrubber.denylist


def test_sentry_scrubs_the_apple_authorization_code_from_a_request_body(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN))
    scrubber = init.call_args.kwargs["event_scrubber"]
    event = {"request": {"data": {"apple_authorization_code": "c1-secret"}}}
    scrubber.scrub_event(event)
    assert "c1-secret" not in str(event)


def test_sentry_defaults_to_the_development_environment(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN))
    assert init.call_args.kwargs["environment"] == "development"


def test_sentry_stays_off_without_a_dsn(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings())
    init.assert_not_called()


def test_sentry_never_sends_request_bodies(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN))
    assert init.call_args.kwargs["max_request_body_size"] == "never"


def test_sentry_drops_query_strings_from_requests(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN))
    before_send = init.call_args.kwargs["before_send"]
    event = {
        "request": {
            "url": "https://api.example.com/v1/places/search?q=galax",
            "query_string": "q=galax",
        }
    }
    sent = before_send(event, {})
    assert "galax" not in str(sent)
    assert sent["request"]["url"] == "https://api.example.com/v1/places/search"


def test_sentry_scrubs_search_text_and_coordinates_from_frames(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN))
    scrubber = init.call_args.kwargs["event_scrubber"]
    frame = {
        "vars": {
            "q": "galax",
            "query": "silver spear",
            "lat": "36.66",
            "lon": "-80.92",
            "params": {"loc": "36.66,-80.92"},
        }
    }
    event = {"exception": {"values": [{"stacktrace": {"frames": [frame]}}]}}
    scrubber.scrub_event(event)
    for text in ("galax", "silver", "36.66", "80.92"):
        assert text not in str(event)


def test_sentry_scrubs_outbound_query_strings_from_breadcrumbs(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN))
    scrubber = init.call_args.kwargs["event_scrubber"]
    crumb = {
        "category": "httplib",
        "data": {
            "url": "https://maps-api.apple.com/v1/search",
            "http.query": "q=galax",
            "http.fragment": "36.66",
        },
    }
    event = {"breadcrumbs": {"values": [crumb]}}
    scrubber.scrub_event(event)
    assert "galax" not in str(event)
    assert "36.66" not in str(event)


class _Captured(Transport):
    def __init__(self) -> None:
        super().__init__()
        self.envelopes: list[Envelope] = []

    def capture_envelope(self, envelope: Envelope) -> None:
        self.envelopes.append(envelope)


class _Notes(BaseModel):
    notes: str
    players: str


@pytest.fixture
def live_sentry(mocker):
    """Initialize the real SDK with the app's options and an in-memory transport."""
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN))
    options = init.call_args.kwargs
    mocker.stop(init)
    transport = _Captured()
    sentry_sdk.init(**options, transport=transport)
    yield transport
    sentry_sdk.get_client().close()
    sentry_sdk.init()


def test_sentry_reports_keep_coordinates_and_content_out_of_frame_locals(live_sentry) -> None:
    def fail() -> None:
        info = Probe(
            codec="aac",
            format_names=frozenset({"mov"}),
            bit_rate=None,
            duration_ms=1000,
            channels=1,
            location=(36.6612, -80.9239),
        )
        hit = PlaceHit(name="Galax, VA", lat=36.6612, lon=-80.9239, title="Galax, VA", kind="town")
        body = _Notes(notes="learned from Tommy", players="Kyle Creed")
        report = {
            "format": {"tags": {"com.apple.quicktime.location.ISO6709": "+36.6612-080.9239/"}}
        }
        location = "+36.6612-080.9239/"
        raise RuntimeError(str(len([info, hit, body, report, location])))

    try:
        fail()
    except RuntimeError:
        sentry_sdk.capture_exception()
    sentry_sdk.flush()

    (envelope,) = live_sentry.envelopes
    event = envelope.get_event()
    assert event is not None
    # Source context quotes this test's own literals, so only the locals are checked.
    frames = event["exception"]["values"][0]["stacktrace"]["frames"]
    sent = json.dumps([frame.get("vars") for frame in frames])
    assert "<Probe redacted>" in sent
    for text in ("36.66", "80.92", "Galax", "Tommy", "Kyle"):
        assert text not in sent


@pytest.mark.anyio
async def test_a_media_tool_over_its_output_cap_keeps_the_report_out_of_sentry(
    live_sentry,
) -> None:
    # Hex keeps the coordinates out of the command line, so only the output holds them.
    tag = b"+36.6612-080.9239/".hex()
    script = f"print(bytes.fromhex('{tag}').decode() * 1000)"
    try:
        await run_media_tool(sys.executable, "-c", script, max_bytes=100)
    except MediaError:
        sentry_sdk.capture_exception()
    sentry_sdk.flush()

    (envelope,) = live_sentry.envelopes
    event = envelope.get_event()
    assert event is not None
    frames = event["exception"]["values"][0]["stacktrace"]["frames"]
    assert "36.66" not in json.dumps([frame.get("vars") for frame in frames])


# Recording content a push carries; none of it may reach an error report.
_CONTENT = {
    "notes": "Learned in Joe's kitchen",
    "players": "Kevin and Ed",
    "place_name": "Galax, VA",
    "place_lat": 36.6612,
    "place_lon": -80.9239,
    "place_accuracy_m": 17,
}
_CONTENT_TEXT = ("Joe's kitchen", "Kevin and Ed", "Galax", "36.66", "80.92")


async def _push_failing(client, auth_headers, *changes: dict) -> None:
    with pytest.raises(RuntimeError):
        await client.post(
            "/v1/sync/push",
            json={"changes": list(changes) or [recording(uid(), **_CONTENT)]},
            headers=auth_headers("user_a"),
        )
    sentry_sdk.flush()


def _events(transport: _Captured) -> list[dict]:
    events = [e.get_event() for e in transport.envelopes]
    sent = [event for event in events if event is not None]
    assert sent
    return sent


_TIME_KEYS = {"timestamp", "start_timestamp"}


def _untimed(value: object) -> object:
    # A timestamp's digits can match a coordinate's by chance.
    if isinstance(value, dict):
        return {k: _untimed(v) for k, v in value.items() if k not in _TIME_KEYS}
    if isinstance(value, list):
        return [_untimed(v) for v in value]
    return value


def _sent_event(transport: _Captured) -> str:
    return json.dumps(_untimed(_events(transport)))


def _frames(transport: _Captured) -> list[dict]:
    return [
        frame
        for event in _events(transport)
        for exception in event["exception"]["values"]
        for frame in exception["stacktrace"]["frames"]
    ]


def _frame(transport: _Captured, function: str) -> dict:
    [frame] = [f for f in _frames(transport) if f["function"] == function]
    return frame


@pytest.mark.anyio
async def test_an_unhandled_push_error_keeps_recording_content_out_of_sentry(
    live_sentry, client, auth_headers, mocker
) -> None:
    mocker.patch.object(RecordingRules, "prepare", side_effect=RuntimeError("boom"))
    await _push_failing(client, auth_headers)
    sent = _sent_event(live_sentry)
    for text in _CONTENT_TEXT:
        assert text not in sent


@pytest.mark.anyio
async def test_an_error_in_a_push_write_keeps_recording_content_out_of_sentry(
    live_sentry, client, auth_headers, mocker
) -> None:
    mocker.patch.object(AsyncSession, "begin_nested", side_effect=RuntimeError("boom"))
    await _push_failing(client, auth_headers)
    sent = _sent_event(live_sentry)
    for text in _CONTENT_TEXT:
        assert text not in sent
    # The API's own frames keep their locals, redacted where they hold content.
    assert _frame(live_sentry, "_write")["vars"]["change"] == "<Change redacted>"


def test_database_errors_leave_out_the_statement_values() -> None:
    engine = make_engine("postgresql+asyncpg://user@localhost/crosstune")
    assert engine.sync_engine.hide_parameters is True


def test_sentry_keeps_harmless_locals_of_the_apis_own_frames(live_sentry) -> None:
    def fail() -> None:
        attempts = 3
        raise RuntimeError(str(attempts))

    try:
        fail()
    except RuntimeError:
        sentry_sdk.capture_exception()
    sentry_sdk.flush()

    assert _frame(live_sentry, "fail")["vars"]["attempts"] == "3"


@pytest.mark.anyio
async def test_an_unhandled_request_error_keeps_the_token_and_query_out_of_sentry(
    live_sentry, app, client, auth_headers, mocker
) -> None:
    app.state.maps = mocker.Mock(search=mocker.AsyncMock(side_effect=RuntimeError("boom")))
    headers = auth_headers("user_a")
    token = headers["Authorization"].removeprefix("Bearer ")
    with pytest.raises(RuntimeError):
        await client.get("/v1/places/search?q=fiddlersgrove", headers=headers)
    sentry_sdk.flush()

    sent = _sent_event(live_sentry)
    signature = token.rsplit(".", 1)[1]
    for text in (token, signature, "Bearer ey", "fiddlersgrove"):
        assert text not in sent


def test_sentry_drops_the_value_from_a_driver_encode_error() -> None:
    message = (
        "(sqlalchemy.dialects.postgresql.asyncpg.Error) <class 'asyncpg.exceptions.DataError'>: "
        "invalid input for query argument $3: 'Learned in Joe (the barn)...' "
        "(expected str, got int)\n[SQL: INSERT INTO recordings]"
    )
    event = {"exception": {"values": [{"type": "DBAPIError", "value": message}]}}
    value = before_send(event, {})["exception"]["values"][0]["value"]
    assert "Joe" not in value
    assert "invalid input for query argument $3: <value redacted> (expected str, got int)" in value
    assert "[SQL: INSERT INTO recordings]" in value


def test_sentry_drops_the_input_from_a_validation_error_message(live_sentry) -> None:
    def fail() -> None:
        SearchResult(**_UNKNOWN_PROVIDER_HIT)

    try:
        fail()
    except ValidationError:
        sentry_sdk.capture_exception()
    sentry_sdk.flush()

    [exception] = _events(live_sentry)[0]["exception"]["values"]
    assert "input_value=<value redacted>, input_type=str]" in exception["value"]
    assert _UNKNOWN_PROVIDER_HIT["provider"] not in _sent_event(live_sentry)


def test_sentry_scrubs_apple_maps_place_fields_from_frames(mocker) -> None:
    init = mocker.patch("crosstune.main.sentry_sdk.init")
    create_app(Settings(sentry_dsn=DSN))
    scrubber = init.call_args.kwargs["event_scrubber"]
    result = {
        "coordinate": {"latitude": 36.6612, "longitude": -80.9239},
        "structuredAddress": {"locality": "Galax", "fullThoroughfare": "12 Oldtown Rd"},
        "formattedAddressLines": ["12 Oldtown Rd", "Galax, VA 24333"],
    }
    suggestion = {
        "displayLines": ["Rex Theater", "113 E Grayson St, Galax, VA  24333, United States"],
        "location": {"latitude": 36.6612, "longitude": -80.9239},
    }
    frame = {
        "vars": {
            "result": result,
            "results": [result, suggestion],
            "coordinate": result["coordinate"],
            "location": suggestion["location"],
            "address": result["structuredAddress"],
            "locality": "Galax",
            "raw": suggestion["displayLines"],
            "lines": suggestion["displayLines"],
            "parts": ["113 E Grayson St", "Galax", "VA"],
            "town": "Galax, VA",
            "title": "Rex Theater",
            "subtitle": "113 E Grayson St, Galax, VA",
            "stored": "Rex Theater, 113 E Grayson St, Galax, VA",
            "picked": {"title": "Rex Theater"},
            "country": "IE",
            "home": {"name": "Ireland"},
        }
    }
    event = {"exception": {"values": [{"stacktrace": {"frames": [frame]}}]}}
    scrubber.scrub_event(event)
    for text in ("36.66", "80.92", "Galax", "Oldtown", "Rex", "Grayson", "IE", "Ireland"):
        assert text not in str(event)


@pytest.mark.anyio
async def test_an_error_while_settling_a_pushed_place_keeps_coordinates_out_of_sentry(
    live_sentry, client, auth_headers, mocker
) -> None:
    mocker.patch("crosstune.sync.rules.matching_place_id", side_effect=RuntimeError("boom"))
    await _push_failing(client, auth_headers)
    assert _frame(live_sentry, "_settle_place")["vars"]
    sent = _sent_event(live_sentry)
    for text in _CONTENT_TEXT:
        assert text not in sent


@pytest.mark.anyio
async def test_an_error_while_reaching_back_keeps_place_coordinates_out_of_sentry(
    live_sentry, client, auth_headers, mocker
) -> None:
    headers = auth_headers("user_a")
    await push(client, headers, recording(uid(), **_CONTENT))
    mocker.patch("crosstune.places.matching.distance_m", side_effect=RuntimeError("boom"))
    with pytest.raises(RuntimeError):
        await client.post(
            "/v1/sync/push",
            json={
                "changes": [change("places", uid(), T1, name="Porch", lat=36.6612, lon=-80.9239)]
            },
            headers=headers,
        )
    sentry_sdk.flush()
    assert _frame(live_sentry, "link_earlier_recordings")["vars"]
    sent = _sent_event(live_sentry)
    for text in _CONTENT_TEXT:
        assert text not in sent


@pytest.mark.anyio
async def test_an_error_in_a_push_write_keeps_pasted_links_out_of_sentry(
    live_sentry, client, auth_headers, mock_http, mocker
) -> None:
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(200, json=OEMBED))
    mocker.patch.object(AsyncSession, "begin_nested", side_effect=RuntimeError("boom"))
    tune = uid()
    await _push_failing(
        client,
        auth_headers,
        change("tunes", tune, T1, title="X"),
        change(
            "recording_links",
            uid(),
            T1,
            tune_id=tune,
            url="https://youtu.be/dQw4w9WgXcQ",
            provider="youtube",
        ),
    )
    assert _frame(live_sentry, "apply_push")["vars"]
    sent = _sent_event(live_sentry)
    for text in ("dQw4w9WgXcQ", OEMBED["title"]):
        assert text not in sent


@pytest.mark.anyio
async def test_an_unrecorded_withdrawal_email_keeps_the_address_and_body_out_of_sentry(
    live_sentry, mocker
) -> None:
    address = "kyle.creed@example.com"
    settings = Settings()
    message = withdrawal_email(to=address, web_origin=settings.web_origin)
    mocker.patch.object(withdrawal, "notice_recorded", mocker.AsyncMock(return_value=False))
    mocker.patch.object(
        withdrawal,
        "record_notice",
        mocker.AsyncMock(
            side_effect=OperationalError("INSERT", params=None, orig=Exception("down"))
        ),
    )
    await withdrawal.send_confirmation(mocker.Mock(), FakeMailer(), address, "sub_1", settings)
    sentry_sdk.flush()
    assert _frame(live_sentry, "send_confirmation")["vars"]
    sent = _sent_event(live_sentry)
    for text in ("kyle.creed", message.subject, *filter(None, message.text.splitlines())):
        assert text not in sent


@pytest.mark.parametrize(
    ("value", "redacted"),
    [
        (ResolvedLink("https://youtu.be/x", "youtube", "x", "Angeline", None), True),
        (DailyLimits(per_account=1, team=2), False),
    ],
)
def test_the_apis_dataclasses_are_redacted_unless_marked_reportable(
    value: object, *, redacted: bool
) -> None:
    assert (redacted_repr(value) is not None) is redacted
