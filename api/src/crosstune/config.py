"""Application settings, read from the environment with the CROSSTUNE_ prefix."""

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Self
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import dotenv_values
from pydantic import ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_LIBPQ_SCHEMES = {"postgres", "postgresql"}
PRODUCTION_BUCKET = "crosstune-recordings"
PREVIEW_BUCKET = "crosstune-recordings-preview"
LOCAL_BUCKET = "crosstune-local"
E2E_BUCKET = "crosstune-e2e"
_HOSTED_WITHOUT_PREFIX = {"development", "production"}

# Settings the API no longer reads, each mapped to the name it now reads instead. Settings
# ignores unknown names, so without this a host still on an old storage name would start
# with storage unconfigured and fail every upload.
RETIRED_NAMES = {
    "CROSSTUNE_R2_BUCKET": "CROSSTUNE_STORAGE_BUCKET",
    "CROSSTUNE_R2_ACCESS_KEY_ID": "CROSSTUNE_STORAGE_ACCESS_KEY_ID",
    "CROSSTUNE_R2_SECRET_ACCESS_KEY": "CROSSTUNE_STORAGE_SECRET_ACCESS_KEY",
    "CROSSTUNE_R2_PREFIX": "CROSSTUNE_STORAGE_PREFIX",
    "CROSSTUNE_R2_ENDPOINT_URL": "CROSSTUNE_LOCAL_STORAGE_ENDPOINT_URL",
    "CROSSTUNE_R2_BROWSER_ENDPOINT_URL": "CROSSTUNE_LOCAL_STORAGE_BROWSER_ENDPOINT_URL",
    "CROSSTUNE_RESOLVER_TIMEOUT_SECONDS": "CROSSTUNE_LINK_RESOLVE_TIMEOUT_SECONDS",
}


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


class Settings(BaseSettings):
    """Runtime configuration."""

    model_config = SettingsConfigDict(
        env_prefix="CROSSTUNE_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    environment: str = "development"
    debug: bool = False
    database_url: str = "postgresql+asyncpg://crosstune:crosstune@localhost:5432/crosstune"
    clerk_issuer: str = ""
    clerk_authorized_parties: list[str] = []
    clerk_authorized_party_regex: str = ""
    clerk_webhook_secret: str = ""
    sentry_dsn: str = ""
    link_resolve_timeout_seconds: float = 5.0
    link_resolves_per_minute: int = 30
    pull_page_size: int = 500
    r2_account_id: str = ""
    storage_bucket: str = ""
    storage_access_key_id: str = ""
    storage_secret_access_key: str = ""
    storage_prefix: str = ""
    local_storage_endpoint_url: str = ""
    local_storage_browser_endpoint_url: str = ""
    recording_quota_bytes: int = 1_073_741_824
    recording_max_file_bytes: int = 52_428_800
    job_poll_seconds: float = 3.0
    orphan_sweep_seconds: float = 3600.0

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
            and self.storage_secret_access_key
        )

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

    @property
    def clerk_jwks_url(self) -> str:
        """JWKS endpoint derived from the issuer."""
        return f"{self.clerk_issuer.rstrip('/')}/.well-known/jwks.json"

    @model_validator(mode="after")
    def _refuse_retired_names(self) -> Self:
        """Refuse a retired name set without its replacement, since nothing would read it.

        A retired name beside its replacement is accepted, so a host can hold both while it
        moves from one release to the next.
        """
        present = self._names_present()
        stale = [
            f"{old} is now {new}"
            for old, new in RETIRED_NAMES.items()
            if old in present and new not in present
        ]
        if stale:
            msg = f"retired settings: {'; '.join(stale)}"
            raise ValueError(msg)
        return self

    def _names_present(self) -> set[str]:
        """Names set to a non-empty value in the process environment or the env file."""
        names = {name.upper() for name, value in os.environ.items() if value}
        env_file = self.model_config.get("env_file")
        if isinstance(env_file, str | Path) and Path(env_file).is_file():
            names |= {name.upper() for name, value in dotenv_values(env_file).items() if value}
        return names

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

    def _endpoint_problem(self) -> str | None:
        env = self.environment
        if self.local_storage_endpoint_url and env != "development" and not self.e2e_database:
            return f"CROSSTUNE_LOCAL_STORAGE_ENDPOINT_URL is for local work, not {env}"
        return None


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings, built once."""
    return Settings()
