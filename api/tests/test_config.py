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


def test_r2_configured_accepts_an_endpoint_in_place_of_the_account() -> None:
    settings = Settings(
        r2_endpoint_url="http://localhost:9000",
        r2_bucket="crosstune-local",
        r2_access_key_id="crosstune",  # gitleaks:allow -- fixture, not a credential
        r2_secret_access_key="crosstune-local-secret",  # gitleaks:allow -- fixture, not a credential
    )
    assert settings.r2_configured is True
    assert settings.r2_endpoint == "http://localhost:9000"


def test_r2_endpoint_defaults_to_the_account_endpoint() -> None:
    assert Settings(r2_account_id="acct").r2_endpoint == "https://acct.r2.cloudflarestorage.com"


def test_browser_endpoint_is_accepted_with_a_local_endpoint() -> None:
    settings = Settings(r2_endpoint_url="http://localhost:9000", r2_browser_endpoint_url="/storage")
    assert settings.r2_browser_endpoint_url == "/storage"


def test_browser_endpoint_is_refused_without_a_local_endpoint() -> None:
    with pytest.raises(ValidationError, match="storage"):
        Settings(r2_browser_endpoint_url="/storage")


STORE = {
    "r2_bucket": "crosstune-recordings-dev",
    "r2_access_key_id": "test-access-key",  # gitleaks:allow -- fixture, not a credential
    "r2_secret_access_key": "test-secret",  # gitleaks:allow -- fixture, not a credential
}
R2 = {**STORE, "r2_account_id": "acct"}
LOCAL_STORE = {**STORE, "r2_bucket": "crosstune-local", "r2_endpoint_url": "http://localhost:9000"}
E2E_DB = "postgresql+asyncpg://crosstune:crosstune@localhost:5432/crosstune_e2e"


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param(
            {"environment": "production", **R2, "r2_bucket": "crosstune-recordings"},
            id="production",
        ),
        pytest.param({"environment": "development", **R2}, id="hosted-dev"),
        pytest.param(
            {
                "environment": "pr-44",
                **R2,
                "r2_bucket": "crosstune-recordings-preview",
                "r2_prefix": "pr-44/",
            },
            id="pr",
        ),
        pytest.param({"environment": "development", **LOCAL_STORE}, id="local"),
        pytest.param(
            {"environment": "development", **LOCAL_STORE, "r2_browser_endpoint_url": "/storage"},
            id="local-with-browser-endpoint",
        ),
        pytest.param(
            {
                "environment": "development",
                **LOCAL_STORE,
                "r2_bucket": "crosstune-e2e",
                "database_url": E2E_DB,
            },
            id="local-e2e",
        ),
        pytest.param(
            {
                "environment": "test",
                **LOCAL_STORE,
                "r2_bucket": "crosstune-e2e",
                "database_url": E2E_DB,
            },
            id="local-e2e-outside-development",
        ),
        pytest.param({"environment": "pr-44"}, id="pr-without-storage"),
        pytest.param(
            {"environment": "development", "database_url": E2E_DB}, id="e2e-without-storage"
        ),
    ],
)
def test_storage_scope_accepts(overrides: dict[str, str]) -> None:
    Settings(**overrides)


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"environment": "pr-44", **R2}, id="pr-without-prefix"),
        pytest.param(
            {"environment": "pr-44", **R2, "r2_prefix": "pr-45/"}, id="pr-with-another-prefix"
        ),
        pytest.param(
            {"environment": "development", **R2, "r2_prefix": "pr-44/"},
            id="development-with-prefix",
        ),
        pytest.param(
            {
                "environment": "production",
                **R2,
                "r2_bucket": "crosstune-recordings",
                "r2_prefix": "x/",
            },
            id="production-with-prefix",
        ),
        pytest.param(
            {"environment": "pr-44", **R2, "r2_prefix": "pr-44"}, id="prefix-without-slash"
        ),
        pytest.param(
            {"environment": "development", **R2, "r2_bucket": "crosstune-recordings"},
            id="production-bucket-elsewhere",
        ),
        pytest.param(
            {"environment": "pr-44", **LOCAL_STORE, "r2_prefix": "pr-44/"}, id="endpoint-on-a-pr"
        ),
        pytest.param(
            {"environment": "production", **LOCAL_STORE, "r2_bucket": "crosstune-recordings"},
            id="endpoint-on-production",
        ),
        pytest.param(
            {"environment": "development", **R2, "database_url": E2E_DB}, id="e2e-on-hosted-r2"
        ),
        pytest.param(
            {"environment": "development", **R2, "r2_bucket": "crosstune-recordings-preview"},
            id="preview-bucket-on-development",
        ),
        pytest.param(
            {"environment": "production", **R2, "r2_bucket": "crosstune-recordings-preview"},
            id="preview-bucket-on-production",
        ),
        pytest.param({"environment": "pr-44", **R2, "r2_prefix": "pr-44/"}, id="pr-on-dev-bucket"),
        pytest.param({"environment": "production", **R2}, id="production-on-dev-bucket"),
        pytest.param(
            {"environment": "development", **R2, "r2_browser_endpoint_url": "/storage"},
            id="browser-endpoint-without-a-local-endpoint",
        ),
        pytest.param(
            {"environment": "development", **LOCAL_STORE, "database_url": E2E_DB},
            id="e2e-on-the-local-bucket",
        ),
        pytest.param(
            {"environment": "development", **LOCAL_STORE, "r2_bucket": "crosstune-e2e"},
            id="e2e-bucket-without-an-e2e-database",
        ),
    ],
)
def test_storage_scope_refuses(overrides: dict[str, str]) -> None:
    with pytest.raises(ValidationError, match="storage"):
        Settings(**overrides)
