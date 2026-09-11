"""Application settings, read from the environment with the CROSSTUNE_ prefix."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration."""

    model_config = SettingsConfigDict(
        env_prefix="CROSSTUNE_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    debug: bool = False
    database_url: str = "postgresql+asyncpg://crosstune:crosstune@localhost:5432/crosstune"
    clerk_issuer: str = ""
    clerk_authorized_parties: list[str] = []
    clerk_webhook_secret: str = ""
    cors_origins: list[str] = []
    sentry_dsn: str = ""
    resolver_timeout_seconds: float = 5.0
    pull_page_size: int = 500

    @property
    def clerk_jwks_url(self) -> str:
        """JWKS endpoint derived from the issuer."""
        return f"{self.clerk_issuer.rstrip('/')}/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings, built once."""
    return Settings()
