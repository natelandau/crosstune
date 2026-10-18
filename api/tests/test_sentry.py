"""Sentry is initialized only with a DSN and always tagged with the environment."""

from crosstune.config import Settings
from crosstune.main import create_app

DSN = "https://key@o1.ingest.sentry.io/1"


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
