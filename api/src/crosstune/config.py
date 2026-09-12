"""Application settings, read from the environment with the CROSSTUNE_ prefix."""

import re
from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_LIBPQ_SCHEMES = {"postgres", "postgresql"}


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
    cors_origins: list[str] = []
    cors_origin_regex: str = ""
    sentry_dsn: str = ""
    resolver_timeout_seconds: float = 5.0
    pull_page_size: int = 500

    @field_validator("database_url")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        """Hand asyncpg the URL shape it accepts, whatever shape the host printed."""
        return normalize_database_url(value)

    @field_validator("clerk_authorized_party_regex", "cors_origin_regex")
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


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings, built once."""
    return Settings()
