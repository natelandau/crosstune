"""Settings accept the connection string a Postgres host prints and hand asyncpg what it needs."""

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
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


def test_storage_configured_requires_all_four_values() -> None:
    complete = {
        "r2_account_id": "acct",
        "storage_bucket": "crosstune-test",
        "storage_access_key_id": "test-access-key",  # gitleaks:allow -- fixture, not a credential
        "storage_secret_access_key": "test-secret",  # gitleaks:allow -- fixture, not a credential
    }
    assert Settings(**complete).storage_configured is True
    for missing in complete:
        assert Settings(**{**complete, missing: ""}).storage_configured is False


def test_storage_configured_accepts_an_endpoint_in_place_of_the_account() -> None:
    settings = Settings(
        local_storage_endpoint_url="http://localhost:9000",
        storage_bucket="crosstune-local",
        storage_access_key_id="crosstune",  # gitleaks:allow -- fixture, not a credential
        storage_secret_access_key="crosstune-local-secret",  # gitleaks:allow -- fixture, not a credential
    )
    assert settings.storage_configured is True
    assert settings.storage_endpoint == "http://localhost:9000"


def test_storage_endpoint_defaults_to_the_account_endpoint() -> None:
    assert (
        Settings(r2_account_id="acct").storage_endpoint == "https://acct.r2.cloudflarestorage.com"
    )


def test_browser_endpoint_is_accepted_with_a_local_endpoint() -> None:
    settings = Settings(
        local_storage_endpoint_url="http://localhost:9000",
        local_storage_browser_endpoint_url="/storage",
    )
    assert settings.local_storage_browser_endpoint_url == "/storage"


def test_browser_endpoint_is_refused_without_a_local_endpoint() -> None:
    with pytest.raises(ValidationError, match="storage"):
        Settings(local_storage_browser_endpoint_url="/storage")


STORE = {
    "storage_bucket": "crosstune-recordings-dev",
    "storage_access_key_id": "test-access-key",  # gitleaks:allow -- fixture, not a credential
    "storage_secret_access_key": "test-secret",  # gitleaks:allow -- fixture, not a credential
}
R2 = {**STORE, "r2_account_id": "acct"}
LOCAL_STORE = {
    **STORE,
    "storage_bucket": "crosstune-local",
    "local_storage_endpoint_url": "http://localhost:9000",
}
E2E_DB = "postgresql+asyncpg://crosstune:crosstune@localhost:5432/crosstune_e2e"
WORKTREE_DB = "postgresql+asyncpg://crosstune:crosstune@localhost:5432/crosstune_wt_feat_x"
WORKTREE_STORE = {
    **LOCAL_STORE,
    "storage_bucket": "crosstune-wt-feat-x",
    "database_url": WORKTREE_DB,
}


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param(
            {"environment": "production", **R2, "storage_bucket": "crosstune-recordings"},
            id="production",
        ),
        pytest.param({"environment": "development", **R2}, id="hosted-dev"),
        pytest.param(
            {
                "environment": "pr-44",
                **R2,
                "storage_bucket": "crosstune-recordings-preview",
                "storage_prefix": "pr-44/",
            },
            id="pr",
        ),
        pytest.param({"environment": "development", **LOCAL_STORE}, id="local"),
        pytest.param(
            {
                "environment": "development",
                **LOCAL_STORE,
                "local_storage_browser_endpoint_url": "/storage",
            },
            id="local-with-browser-endpoint",
        ),
        pytest.param(
            {
                "environment": "development",
                **LOCAL_STORE,
                "storage_bucket": "crosstune-e2e",
                "database_url": E2E_DB,
            },
            id="local-e2e",
        ),
        pytest.param(
            {
                "environment": "test",
                **LOCAL_STORE,
                "storage_bucket": "crosstune-e2e",
                "database_url": E2E_DB,
            },
            id="local-e2e-outside-development",
        ),
        pytest.param({"environment": "development", **WORKTREE_STORE}, id="local-worktree"),
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
            {"environment": "pr-44", **R2, "storage_prefix": "pr-45/"}, id="pr-with-another-prefix"
        ),
        pytest.param(
            {"environment": "development", **R2, "storage_prefix": "pr-44/"},
            id="development-with-prefix",
        ),
        pytest.param(
            {
                "environment": "production",
                **R2,
                "storage_bucket": "crosstune-recordings",
                "storage_prefix": "x/",
            },
            id="production-with-prefix",
        ),
        pytest.param(
            {"environment": "pr-44", **R2, "storage_prefix": "pr-44"}, id="prefix-without-slash"
        ),
        pytest.param(
            {"environment": "development", **R2, "storage_bucket": "crosstune-recordings"},
            id="production-bucket-elsewhere",
        ),
        pytest.param(
            {"environment": "pr-44", **LOCAL_STORE, "storage_prefix": "pr-44/"},
            id="endpoint-on-a-pr",
        ),
        pytest.param(
            {"environment": "production", **LOCAL_STORE, "storage_bucket": "crosstune-recordings"},
            id="endpoint-on-production",
        ),
        pytest.param(
            {"environment": "development", **R2, "database_url": E2E_DB}, id="e2e-on-hosted-r2"
        ),
        pytest.param(
            {"environment": "development", **R2, "storage_bucket": "crosstune-recordings-preview"},
            id="preview-bucket-on-development",
        ),
        pytest.param(
            {"environment": "production", **R2, "storage_bucket": "crosstune-recordings-preview"},
            id="preview-bucket-on-production",
        ),
        pytest.param(
            {"environment": "pr-44", **R2, "storage_prefix": "pr-44/"}, id="pr-on-dev-bucket"
        ),
        pytest.param({"environment": "production", **R2}, id="production-on-dev-bucket"),
        pytest.param(
            {"environment": "development", **R2, "local_storage_browser_endpoint_url": "/storage"},
            id="browser-endpoint-without-a-local-endpoint",
        ),
        pytest.param(
            {"environment": "development", **LOCAL_STORE, "database_url": E2E_DB},
            id="e2e-on-the-local-bucket",
        ),
        pytest.param(
            {"environment": "development", **LOCAL_STORE, "storage_bucket": "crosstune-e2e"},
            id="e2e-bucket-without-an-e2e-database",
        ),
        pytest.param(
            {"environment": "development", **LOCAL_STORE, "database_url": WORKTREE_DB},
            id="worktree-on-the-local-bucket",
        ),
        pytest.param(
            {
                **WORKTREE_STORE,
                "environment": "development",
                "storage_bucket": "crosstune-wt-feat-y",
            },
            id="worktree-on-another-worktree-bucket",
        ),
        pytest.param(
            {"environment": "development", **R2, "database_url": WORKTREE_DB},
            id="worktree-on-hosted-r2",
        ),
        pytest.param(
            {"environment": "development", **LOCAL_STORE, "storage_bucket": "crosstune-wt-feat-x"},
            id="worktree-bucket-without-a-worktree-database",
        ),
    ],
)
def test_storage_scope_refuses(overrides: dict[str, str]) -> None:
    with pytest.raises(ValidationError, match="storage"):
        Settings(**overrides)


CLERK = {
    "clerk_issuer": "https://clerk.example.test",
    "clerk_authorized_parties": ["https://example.test"],
    "clerk_secret_key": "sk_test_fixture",  # gitleaks:allow -- fixture, not a credential
}


@pytest.mark.parametrize("environment", ["production", "pr-44"])
@pytest.mark.parametrize(
    ("missing", "named"),
    [
        ({"clerk_issuer": ""}, "CROSSTUNE_CLERK_ISSUER"),
        ({"clerk_authorized_parties": []}, "CROSSTUNE_CLERK_AUTHORIZED_PARTIES"),
        ({"clerk_secret_key": ""}, "CROSSTUNE_CLERK_SECRET_KEY"),
    ],
)
def test_a_hosted_environment_refuses_to_start_without_clerk_checks(
    environment: str, missing: dict[str, object], named: str
) -> None:
    with pytest.raises(ValidationError, match=named):
        Settings(environment=environment, **{**CLERK, **missing})


@pytest.mark.parametrize(
    "clerk",
    [
        CLERK,
        {
            "clerk_issuer": CLERK["clerk_issuer"],
            "clerk_authorized_party_regex": "^https://x$",
            "clerk_secret_key": CLERK["clerk_secret_key"],
        },
    ],
    ids=["parties", "regex"],
)
def test_a_hosted_environment_starts_with_an_issuer_and_a_party_rule(
    clerk: dict[str, object],
) -> None:
    Settings(environment="production", **clerk)


def test_development_starts_without_clerk_checks() -> None:
    Settings(environment="development", clerk_issuer="", clerk_authorized_parties=[])


def test_settings_repr_hides_every_secret() -> None:
    """Sentry captures local variables, so a Settings repr must carry no secret."""
    secrets = {
        "clerk_secret_key": "sk_test_reprleak",  # gitleaks:allow -- fixture, not a credential
        "clerk_webhook_secret": "whsec_reprleak",  # gitleaks:allow -- fixture, not a credential
        "storage_secret_access_key": "storage-reprleak",  # gitleaks:allow -- fixture
        "apple_music_private_key": _pem(ec.generate_private_key(ec.SECP256R1())),
        "tidal_client_secret": "tidal-reprleak",  # gitleaks:allow -- fixture, not a credential
    }
    settings = Settings(
        database_url="postgresql+asyncpg://crosstune:dbpassreprleak@localhost:5432/crosstune",
        apple_music_team_id="TEAM",
        apple_music_key_id="KEY",
        tidal_client_id="id",
        **secrets,
    )
    shown = repr(settings) + str(settings)
    for value in [*secrets.values(), "dbpassreprleak"]:
        assert value not in shown


@pytest.mark.parametrize(
    ("given", "named"),
    [
        ({"apple_music_team_id": "TEAM"}, "CROSSTUNE_APPLE_MUSIC_KEY_ID"),
        ({"apple_music_key_id": "KEY"}, "CROSSTUNE_APPLE_MUSIC_TEAM_ID"),
        (
            {"apple_music_team_id": "TEAM", "apple_music_key_id": "KEY"},
            "CROSSTUNE_APPLE_MUSIC_PRIVATE_KEY",
        ),
        ({"tidal_client_id": "id"}, "CROSSTUNE_TIDAL_CLIENT_SECRET"),
        ({"tidal_client_secret": "value"}, "CROSSTUNE_TIDAL_CLIENT_ID"),
    ],
)
def test_partial_music_credentials_refuse_to_start(given: dict[str, str], named: str) -> None:
    with pytest.raises(ValidationError, match=named):
        Settings(**given)


def test_partial_apple_music_credentials_refuse_to_start() -> None:
    with pytest.raises(ValidationError, match="CROSSTUNE_APPLE_MUSIC_KEY_ID"):
        Settings(apple_music_team_id="TEAM")


def test_no_music_credentials_is_valid_everywhere() -> None:
    settings = Settings(
        environment="production", **CLERK, **{**R2, "storage_bucket": "crosstune-recordings"}
    )
    assert settings.apple_music_configured is False
    assert settings.tidal_configured is False
    assert settings.link_searches_per_minute == 20


def test_whole_music_credentials_are_configured() -> None:
    settings = Settings(
        apple_music_team_id="TEAM",
        apple_music_key_id="KEY",
        apple_music_private_key=_pem(ec.generate_private_key(ec.SECP256R1())),
        tidal_client_id="id",
        tidal_client_secret="value",
    )
    assert settings.apple_music_configured is True
    assert settings.tidal_configured is True


def _pem(key: ec.EllipticCurvePrivateKey | rsa.RSAPrivateKey) -> str:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


@pytest.mark.parametrize(
    ("pem", "reason"),
    [
        # An env file that holds the key on one line with literal \n escapes.
        (_pem(ec.generate_private_key(ec.SECP256R1())).replace("\n", "\\n"), "not a PEM"),
        (_pem(rsa.generate_private_key(public_exponent=65537, key_size=2048)), "not an EC P-256"),
        (_pem(ec.generate_private_key(ec.SECP384R1())), "not an EC P-256"),
    ],
    ids=["escaped-newlines", "rsa", "p384"],
)
def test_an_unusable_apple_music_key_refuses_to_start(pem: str, reason: str) -> None:
    with pytest.raises(ValidationError) as caught:
        Settings(apple_music_team_id="TEAM", apple_music_key_id="KEY", apple_music_private_key=pem)

    message = str(caught.value)
    assert f"CROSSTUNE_APPLE_MUSIC_PRIVATE_KEY is {reason}" in message
    assert pem[40:80] not in message
    assert pem[-60:-30] not in message


def test_a_p256_apple_music_key_starts() -> None:
    settings = Settings(
        apple_music_team_id="TEAM",
        apple_music_key_id="KEY",
        apple_music_private_key=_pem(ec.generate_private_key(ec.SECP256R1())),
    )
    assert settings.apple_music_configured is True


_STORAGE = {
    "r2_account_id": "acct",
    "storage_bucket": "crosstune-test",
    "storage_access_key_id": "test-access-key",  # gitleaks:allow -- fixture, not a credential
    "storage_secret_access_key": "test-secret",  # gitleaks:allow -- fixture, not a credential
}


def test_posthog_configured_needs_project_and_key() -> None:
    assert Settings().posthog_configured is False
    assert (
        Settings(
            posthog_project_id="123", posthog_person_delete_key="phx_test", **_STORAGE
        ).posthog_configured
        is True
    )


def test_posthog_settings_without_storage_refuse_to_start() -> None:
    # The job runner that deletes a deleted account's analytics data runs only with storage.
    with pytest.raises(ValidationError, match="PostHog settings need storage"):
        Settings(posthog_project_id="123", posthog_person_delete_key="phx_test")


@pytest.mark.parametrize(
    ("given", "named"),
    [
        ({"posthog_project_id": "123"}, "CROSSTUNE_POSTHOG_PERSON_DELETE_KEY"),
        ({"posthog_person_delete_key": "phx_test"}, "CROSSTUNE_POSTHOG_PROJECT_ID"),
    ],
)
def test_partial_posthog_settings_refuse_to_start(given: dict[str, str], named: str) -> None:
    with pytest.raises(ValidationError, match=f"{named} is unset"):
        Settings(**given)
