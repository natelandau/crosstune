"""Settings accept the connection string a Postgres host prints and hand asyncpg what it needs."""

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects.postgresql.asyncpg import dialect as asyncpg_dialect
from sqlalchemy.engine import make_url

from crosstune.config import Settings, normalize_database_url

NEON = (
    "postgresql://alex:AbC123dEf@ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech/neondb"
    "?sslmode=require&channel_binding=require"
)
LOCAL = "postgresql+asyncpg://crosstune:crosstune@localhost:5432/crosstune"


def test_neon_connection_string_becomes_an_asyncpg_url() -> None:
    assert normalize_database_url(NEON) == (
        "postgresql+asyncpg://alex:AbC123dEf@ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech"
        "/neondb?ssl=require"
    )


def test_local_asyncpg_url_is_unchanged() -> None:
    assert normalize_database_url(LOCAL) == LOCAL


def test_short_postgres_scheme_is_rewritten() -> None:
    assert normalize_database_url("postgres://u:p@h/d") == "postgresql+asyncpg://u:p@h/d"


def test_other_query_parameters_survive() -> None:
    url = normalize_database_url("postgresql://u:p@h/d?sslmode=verify-full&application_name=x")
    assert url == "postgresql+asyncpg://u:p@h/d?ssl=verify-full&application_name=x"


def test_normalized_url_reaches_asyncpg_as_ssl() -> None:
    _, kwargs = asyncpg_dialect().create_connect_args(make_url(normalize_database_url(NEON)))
    assert kwargs["ssl"] == "require"
    assert "sslmode" not in kwargs
    assert "channel_binding" not in kwargs


def test_settings_normalize_the_database_url() -> None:
    assert Settings(database_url=NEON).database_url.endswith("/neondb?ssl=require")


def test_invalid_party_regex_is_rejected_at_startup() -> None:
    with pytest.raises(ValidationError):
        Settings(clerk_authorized_party_regex="(")


def test_valid_party_regex_is_kept_verbatim() -> None:
    pattern = r"^https://[a-z0-9-]+-crosstune-web\.example\.workers\.dev$"
    settings = Settings(clerk_authorized_party_regex=pattern)
    assert settings.clerk_authorized_party_regex == pattern


def test_r2_configured_requires_all_four_values() -> None:
    complete = {
        "r2_account_id": "acct",
        "r2_bucket": "crosstune-test",
        "r2_access_key_id": "test-access-key",  # gitleaks:allow -- fixture, not a credential
        "r2_secret_access_key": "test-secret",  # gitleaks:allow -- fixture, not a credential
    }
    assert Settings(**complete).r2_configured is True
    for missing in complete:
        assert Settings(**{**complete, missing: ""}).r2_configured is False
