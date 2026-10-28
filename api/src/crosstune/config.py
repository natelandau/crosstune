"""Application settings, read from the environment with the CROSSTUNE_ prefix."""

import re
from functools import lru_cache
from pathlib import Path
from typing import Self
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from pydantic import Field, SecretStr, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from crosstune.client_version import Version, parse_version

_LIBPQ_SCHEMES = {"postgres", "postgresql"}
PRODUCTION_BUCKET = "crosstune-recordings"
PREVIEW_BUCKET = "crosstune-recordings-preview"
LOCAL_BUCKET = "crosstune-local"
E2E_BUCKET = "crosstune-e2e"
# A git worktree's own database and bucket, `just api::worktree-db` names both from one slug.
WORKTREE_DATABASE_PREFIX = "crosstune_wt_"
WORKTREE_BUCKET_PREFIX = "crosstune-wt-"
_HOSTED_WITHOUT_PREFIX = {"development", "production"}


def worktree_bucket(database: str) -> str:
    """The bucket that pairs with a worktree database, so neither can serve another worktree."""
    return WORKTREE_BUCKET_PREFIX + database.removeprefix(WORKTREE_DATABASE_PREFIX).replace(
        "_", "-"
    )


def normalize_database_url(url: str) -> str:
    """Rewrite a libpq-style Postgres URL, as hosts print it, into one asyncpg accepts.

    asyncpg spells the TLS mode `ssl` where libpq spells it `sslmode`, and it rejects
    libpq-only options such as `channel_binding` outright.
    """
    parts = urlsplit(url)
    scheme = "postgresql+asyncpg" if parts.scheme in _LIBPQ_SCHEMES else parts.scheme
    query = [
        ("ssl" if key == "sslmode" else key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key != "channel_binding"
    ]
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _missing_member(members: dict[str, str]) -> str | None:
    """Name the first empty member of a credential set that has another member set."""
    if not any(members.values()):
        return None
    for name, value in members.items():
        if not value:
            return f"{name} is unset"
    return None


def load_apple_p256_key(pem: str) -> ec.EllipticCurvePrivateKey:
    """Parse an Apple signing key, such as the Apple Music or Sign in with Apple key.

    Apple issues each of these `.p8` keys as an EC P-256 private key.

    Args:
        pem: The PEM text of the key.

    Returns:
        ec.EllipticCurvePrivateKey: The parsed key.

    Raises:
        ValueError: If the text is not a PEM private key on the P-256 curve. The message
            never carries the key text.
    """
    try:
        key = load_pem_private_key(pem.encode(), password=None)
    except (ValueError, TypeError, UnsupportedAlgorithm):
        msg = "is not a PEM private key"
        raise ValueError(msg) from None
    if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
        msg = "is not an EC P-256 key"
        raise ValueError(msg)  # noqa: TRY004 -- settings validation reports every unusable key alike
    return key


def _check_apple_key(env_name: str, key: SecretStr) -> None:
    """Refuse an Apple key setting that does not parse, naming the variable but never the key.

    Raises:
        ValueError: If `key` is not a PEM EC P-256 private key.
    """
    try:
        load_apple_p256_key(key.get_secret_value())
    except ValueError as error:
        msg = f"{env_name} {error}"
        raise ValueError(msg) from None


class Settings(BaseSettings):
    """Environment settings that refuse to build when hosted auth or storage config is unsafe."""

    model_config = SettingsConfigDict(
        env_prefix="CROSSTUNE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # A validation error otherwise prints part of the input, which holds every secret.
        hide_input_in_errors=True,
    )

    environment: str = "development"
    geoip_path: Path = Path("/app/geo/dbip-country-lite.mmdb")
    debug: bool = False
    testdata_enabled: bool = False
    # Hidden from repr because the URL carries the password; it stays a plain str since
    # the engine, migrations, and the e2e guard all read it as one.
    database_url: str = Field(
        default="postgresql+asyncpg://crosstune:crosstune@localhost:5432/crosstune", repr=False
    )
    clerk_issuer: str = ""
    clerk_authorized_parties: list[str] = []
    clerk_authorized_party_regex: str = ""
    clerk_webhook_secret: SecretStr = SecretStr("")
    clerk_secret_key: SecretStr = SecretStr("")
    resend_api_key: SecretStr = SecretStr("")
    email_from: str = "Crosstune <no-reply@mail.crosstune.app>"
    web_origin: str = "https://my.crosstune.app"
    sentry_dsn: str = ""
    posthog_api_host: str = "https://us.posthog.com"
    posthog_project_id: str = ""
    posthog_person_delete_key: SecretStr = SecretStr("")
    revenuecat_project_id: str = ""
    revenuecat_secret_key: SecretStr = SecretStr("")
    # Independent of the other RevenueCat settings: a pr environment copies development's.
    revenuecat_webhook_auth: SecretStr = SecretStr("")
    stripe_cancel_key: SecretStr = SecretStr("")
    # Off in production, so a purchase made with Stripe test money never grants Premium there.
    billing_accept_sandbox_stripe: bool = False
    # How long after an account deletion the PostHog person is deleted again: the second
    # pass catches events a client sent just before the account went, and the later ones
    # catch events a device that was offline queued and uploads once it is back.
    posthog_second_delete_seconds: float = 600.0
    posthog_third_delete_seconds: float = 86_400.0
    posthog_fourth_delete_seconds: float = 604_800.0
    link_resolve_timeout_seconds: float = 5.0
    link_resolves_per_minute: int = 30
    link_searches_per_minute: int = 20
    place_searches_per_minute: int = 60
    # Each MapKit JS token or signed snapshot spends the operator's Apple Maps quota.
    mapkit_tokens_per_minute: int = 10
    place_snapshots_per_minute: int = 120
    # Reverse geocodes the job runner makes for one account; the rest wait their turn.
    place_lookups_per_minute: int = 30
    billing_refreshes_per_minute: int = 10
    # How long a request waits on its account's lock before answering 429, and how many
    # sync requests one account may have in flight at once.
    request_lock_timeout_seconds: float = 2.0
    concurrent_sync_requests_per_user: int = 4
    apple_team_id: str = ""
    apple_music_key_id: str = ""
    apple_music_private_key: SecretStr = SecretStr("")
    apple_maps_key_id: str = ""
    apple_maps_private_key: SecretStr = SecretStr("")
    sign_in_with_apple_key_id: str = ""
    sign_in_with_apple_private_key: SecretStr = SecretStr("")
    tidal_client_id: str = ""
    tidal_client_secret: SecretStr = SecretStr("")
    pull_page_size: int = 500
    max_request_body_bytes: int = 33_554_432
    r2_account_id: str = ""
    storage_bucket: str = ""
    storage_access_key_id: str = ""
    storage_secret_access_key: SecretStr = SecretStr("")
    storage_prefix: str = ""
    local_storage_endpoint_url: str = ""
    local_storage_browser_endpoint_url: str = ""
    trial_quota_bytes: int = 100_000_000
    premium_quota_bytes: int = 3_000_000_000
    storage_addon_bytes: int = 50_000_000_000
    trial_days: int = 30
    recording_max_file_bytes: int = 50_000_000
    scan_max_file_bytes: int = 5_242_880
    # Each sweep wakes the database and lists the whole bucket, so an idle app pays
    # for it; orphans are garbage, so a late sweep costs nothing.
    orphan_sweep_seconds: float = 43_200.0
    # Apple builds below this `major.minor.patch` get 426; empty blocks nothing.
    apple_min_version: str = ""

    @property
    def database_name(self) -> str:
        """The database at the end of the connection string."""
        return urlsplit(self.database_url).path.lstrip("/")

    @property
    def e2e_database(self) -> bool:
        """Whether this API is bound to a database the end-to-end suite owns and resets.

        The suite refuses an API that is bound to anything else, because its fixtures would
        land in a database someone else fills by hand.
        """
        return self.database_name.endswith("_e2e")

    @property
    def worktree_database(self) -> bool:
        """Whether this API is bound to the database of one git worktree, not the main checkout's."""
        return self.database_name.startswith(WORKTREE_DATABASE_PREFIX)

    @property
    def storage_endpoint(self) -> str:
        """The S3 endpoint: the configured one, or the R2 endpoint of the account."""
        return (
            self.local_storage_endpoint_url
            or f"https://{self.r2_account_id}.r2.cloudflarestorage.com"
        )

    @property
    def storage_configured(self) -> bool:
        """Whether every storage setting is present. Without them the store stays unbuilt."""
        return bool(
            (self.r2_account_id or self.local_storage_endpoint_url)
            and self.storage_bucket
            and self.storage_access_key_id
            and self.storage_secret_access_key.get_secret_value()
        )

    @property
    def apple_music_configured(self) -> bool:
        """Whether the Apple Music developer key is complete."""
        return bool(
            self.apple_team_id
            and self.apple_music_key_id
            and self.apple_music_private_key.get_secret_value()
        )

    @property
    def apple_maps_configured(self) -> bool:
        """Whether the Apple Maps key is complete."""
        return bool(
            self.apple_team_id
            and self.apple_maps_key_id
            and self.apple_maps_private_key.get_secret_value()
        )

    @property
    def sign_in_with_apple_configured(self) -> bool:
        """Whether the Sign in with Apple key is complete."""
        return bool(
            self.apple_team_id
            and self.sign_in_with_apple_key_id
            and self.sign_in_with_apple_private_key.get_secret_value()
        )

    @property
    def tidal_configured(self) -> bool:
        """Whether the TIDAL client credentials are complete."""
        return bool(self.tidal_client_id and self.tidal_client_secret.get_secret_value())

    @property
    def posthog_configured(self) -> bool:
        """Whether the PostHog project and its person-delete key are both set."""
        return bool(self.posthog_project_id and self.posthog_person_delete_key.get_secret_value())

    @property
    def revenuecat_configured(self) -> bool:
        """Whether the RevenueCat project and its secret key are both set."""
        return bool(self.revenuecat_project_id and self.revenuecat_secret_key.get_secret_value())

    @property
    def mail_configured(self) -> bool:
        """Whether the Resend API key is set."""
        return bool(self.resend_api_key.get_secret_value())

    @property
    def stripe_configured(self) -> bool:
        """Whether the Stripe key that cancels subscriptions is set."""
        return bool(self.stripe_cancel_key.get_secret_value())

    @field_validator("database_url")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        """Hand asyncpg the URL shape it accepts, whatever shape the host printed."""
        return normalize_database_url(value)

    @field_validator("clerk_authorized_party_regex")
    @classmethod
    def _validate_regex(cls, value: str, info: ValidationInfo) -> str:
        """Fail fast on a bad pattern, rather than 500 every request that reaches it."""
        if value:
            try:
                re.compile(value)
            except re.error as exc:
                msg = f"{info.field_name} is not a valid regular expression"
                raise ValueError(msg) from exc
        return value

    @field_validator("apple_min_version")
    @classmethod
    def _validate_apple_min_version(cls, value: str, info: ValidationInfo) -> str:
        """Fail at startup on a typo, rather than silently blocking nothing."""
        if value and parse_version(value) is None:
            msg = f"{info.field_name} is not a version such as 1.2.3"
            raise ValueError(msg)
        return value

    @property
    def apple_min(self) -> Version | None:
        """The Apple version floor, or None when none is set."""
        return parse_version(self.apple_min_version)

    @property
    def clerk_jwks_url(self) -> str:
        """JWKS endpoint derived from the issuer."""
        return f"{self.clerk_issuer.rstrip('/')}/.well-known/jwks.json"

    @model_validator(mode="after")
    def _require_clerk_checks(self) -> Self:
        """Refuse a hosted environment that would accept tokens without checking them fully.

        With no issuer every token is refused, and with no authorized party a token
        issued to any site on the Clerk instance is accepted. Local work is exempt.
        """
        if self.environment != "production" and not self.environment.startswith("pr-"):
            return self
        if not self.clerk_issuer:
            msg = f"{self.environment} needs CROSSTUNE_CLERK_ISSUER"
            raise ValueError(msg)
        if not self.clerk_secret_key.get_secret_value():
            msg = f"{self.environment} needs CROSSTUNE_CLERK_SECRET_KEY"
            raise ValueError(msg)
        if not (self.clerk_authorized_parties or self.clerk_authorized_party_regex):
            msg = (
                f"{self.environment} needs CROSSTUNE_CLERK_AUTHORIZED_PARTIES "
                "or CROSSTUNE_CLERK_AUTHORIZED_PARTY_REGEX"
            )
            raise ValueError(msg)
        return self

    @model_validator(mode="after")
    def _confine_storage(self) -> Self:
        """Refuse to start with storage another environment's database also deletes from.

        Every sweep and purge acts on what this database says, so an API that can
        reach another environment's keys deletes that environment's audio.
        """
        problem = self._storage_problem()
        if problem:
            msg = f"unsafe storage settings: {problem}"
            raise ValueError(msg)
        return self

    @model_validator(mode="after")
    def _require_whole_music_credentials(self) -> Self:
        """Refuse half a credential set or an unusable key, which would fail every search."""
        problem = self._music_credentials_problem()
        if problem:
            msg = f"incomplete music service credentials: {problem}"
            raise ValueError(msg)
        if self.apple_music_configured:
            _check_apple_key(
                env_name="CROSSTUNE_APPLE_MUSIC_PRIVATE_KEY", key=self.apple_music_private_key
            )
        return self

    @model_validator(mode="after")
    def _require_whole_apple_maps_settings(self) -> Self:
        """Refuse half an Apple Maps key or an unusable one, which would fail every place lookup."""
        problem = self._apple_key_problem(
            {
                "CROSSTUNE_APPLE_MAPS_KEY_ID": self.apple_maps_key_id,
                "CROSSTUNE_APPLE_MAPS_PRIVATE_KEY": self.apple_maps_private_key.get_secret_value(),
            }
        )
        if problem:
            msg = f"incomplete Apple Maps settings: {problem}"
            raise ValueError(msg)
        if self.apple_maps_configured:
            _check_apple_key(
                env_name="CROSSTUNE_APPLE_MAPS_PRIVATE_KEY", key=self.apple_maps_private_key
            )
        return self

    @model_validator(mode="after")
    def _require_whole_sign_in_with_apple_settings(self) -> Self:
        """Refuse half a Sign in with Apple key or an unusable one, which would fail every revocation."""
        problem = self._apple_key_problem(
            {
                "CROSSTUNE_SIGN_IN_WITH_APPLE_KEY_ID": self.sign_in_with_apple_key_id,
                "CROSSTUNE_SIGN_IN_WITH_APPLE_PRIVATE_KEY": self.sign_in_with_apple_private_key.get_secret_value(),
            }
        )
        if problem:
            msg = f"incomplete Sign in with Apple settings: {problem}"
            raise ValueError(msg)
        if self.sign_in_with_apple_configured:
            _check_apple_key(
                env_name="CROSSTUNE_SIGN_IN_WITH_APPLE_PRIVATE_KEY",
                key=self.sign_in_with_apple_private_key,
            )
        return self

    @model_validator(mode="after")
    def _require_whole_posthog_settings(self) -> Self:
        """Refuse half the PostHog settings, which would leave account deletion unable to erase analytics."""
        problem = _missing_member(
            {
                "CROSSTUNE_POSTHOG_PROJECT_ID": self.posthog_project_id,
                "CROSSTUNE_POSTHOG_PERSON_DELETE_KEY": self.posthog_person_delete_key.get_secret_value(),
            }
        )
        if problem:
            msg = f"incomplete PostHog settings: {problem}"
            raise ValueError(msg)
        # The job runner, which runs the queued analytics deletions, is built only with storage.
        if self.posthog_configured and not self.storage_configured:
            msg = "PostHog settings need storage, or deleted accounts' analytics data is never deleted"
            raise ValueError(msg)
        return self

    @model_validator(mode="after")
    def _require_whole_billing_settings(self) -> Self:
        """Refuse half the RevenueCat settings, which would leave purchases unreadable."""
        problem = _missing_member(
            {
                "CROSSTUNE_REVENUECAT_PROJECT_ID": self.revenuecat_project_id,
                "CROSSTUNE_REVENUECAT_SECRET_KEY": self.revenuecat_secret_key.get_secret_value(),
            }
        )
        if problem:
            msg = f"incomplete RevenueCat settings: {problem}"
            raise ValueError(msg)
        return self

    def _music_credentials_problem(self) -> str | None:
        return self._apple_key_problem(
            {
                "CROSSTUNE_APPLE_MUSIC_KEY_ID": self.apple_music_key_id,
                "CROSSTUNE_APPLE_MUSIC_PRIVATE_KEY": self.apple_music_private_key.get_secret_value(),
            }
        ) or _missing_member(
            {
                "CROSSTUNE_TIDAL_CLIENT_ID": self.tidal_client_id,
                "CROSSTUNE_TIDAL_CLIENT_SECRET": self.tidal_client_secret.get_secret_value(),
            }
        )

    def _apple_key_problem(self, key: dict[str, str]) -> str | None:
        # The team ID is shared, so it may be set by itself; each key needs it.
        problem = _missing_member(key)
        if problem is None and any(key.values()) and not self.apple_team_id:
            return "CROSSTUNE_APPLE_TEAM_ID is unset"
        return problem

    def _storage_problem(self) -> str | None:
        return self._prefix_problem() or self._browser_endpoint_problem() or self._scope_problem()

    def _browser_endpoint_problem(self) -> str | None:
        if self.local_storage_browser_endpoint_url and not self.local_storage_endpoint_url:
            return "CROSSTUNE_LOCAL_STORAGE_BROWSER_ENDPOINT_URL needs CROSSTUNE_LOCAL_STORAGE_ENDPOINT_URL"
        return None

    def _prefix_problem(self) -> str | None:
        env = self.environment
        if self.storage_prefix and not self.storage_prefix.endswith("/"):
            return f"CROSSTUNE_STORAGE_PREFIX {self.storage_prefix!r} must end in /"
        if env in _HOSTED_WITHOUT_PREFIX and self.storage_prefix:
            return f"{env} owns its whole bucket and takes no CROSSTUNE_STORAGE_PREFIX"
        return None

    def _scope_problem(self) -> str | None:
        if not self.storage_configured:
            return None
        return (
            self._pr_prefix_problem()
            or self._bucket_problem()
            or self._e2e_problem()
            or self._worktree_problem()
            or self._endpoint_problem()
        )

    def _pr_prefix_problem(self) -> str | None:
        env = self.environment
        if env.startswith("pr-") and self.storage_prefix != f"{env}/":
            return f"{env} must set CROSSTUNE_STORAGE_PREFIX to {env}/"
        return None

    def _bucket_problem(self) -> str | None:
        env = self.environment
        bucket = self.storage_bucket
        if bucket == PRODUCTION_BUCKET and env != "production":
            return f"only production may use {PRODUCTION_BUCKET}"
        if env == "production" and bucket != PRODUCTION_BUCKET:
            return f"production must use {PRODUCTION_BUCKET}"
        if bucket == PREVIEW_BUCKET and not env.startswith("pr-"):
            return f"only pr-<number> environments may use {PREVIEW_BUCKET}"
        if env.startswith("pr-") and bucket != PREVIEW_BUCKET:
            return f"{env} must use {PREVIEW_BUCKET}"
        return None

    def _e2e_problem(self) -> str | None:
        if self.e2e_database and not self.local_storage_endpoint_url:
            return (
                "an e2e database may only use local storage (CROSSTUNE_LOCAL_STORAGE_ENDPOINT_URL)"
            )
        if self.e2e_database and self.storage_bucket != E2E_BUCKET:
            return f"an e2e database must use {E2E_BUCKET}"
        if self.storage_bucket == E2E_BUCKET and not self.e2e_database:
            return f"only an e2e database may use {E2E_BUCKET}"
        return None

    def _worktree_problem(self) -> str | None:
        bucket = self.storage_bucket
        if self.worktree_database:
            if not self.local_storage_endpoint_url:
                return "a worktree database may only use local storage (CROSSTUNE_LOCAL_STORAGE_ENDPOINT_URL)"
            expected = worktree_bucket(self.database_name)
            if bucket != expected:
                return f"the worktree database {self.database_name} must use {expected}"
        elif bucket.startswith(WORKTREE_BUCKET_PREFIX):
            return f"only a worktree database may use {bucket}"
        return None

    def _endpoint_problem(self) -> str | None:
        env = self.environment
        if self.local_storage_endpoint_url and env != "development" and not self.e2e_database:
            return f"CROSSTUNE_LOCAL_STORAGE_ENDPOINT_URL is for local work, not {env}"
        return None


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings, built once."""
    return Settings()
