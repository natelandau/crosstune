"""Which services answer a search inline, and where each one's own search page is."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING
from urllib.parse import quote

from crosstune.links.search import apple_music, internet_archive, tidal
from crosstune.links.search.tokens import AppleMusicToken, TidalToken
from crosstune.vocabulary import Provider

if TYPE_CHECKING:
    from crosstune.config import Settings
    from crosstune.links.search.backoff import Backoff
    from crosstune.links.search.types import Adapter

_SEARCH_URLS: dict[Provider, str] = {
    Provider.APPLE_MUSIC: "https://music.apple.com/{country}/search?term={q}",
    Provider.TIDAL: "https://listen.tidal.com/search?q={q}",
    Provider.INTERNET_ARCHIVE: "https://archive.org/search?query={q}",
    Provider.SLIPPERY_HILL: "https://www.slippery-hill.com/tune-search?search_api_fulltext={q}",
    Provider.YOUTUBE: "https://www.youtube.com/results?search_query={q}",
    Provider.SPOTIFY: "https://open.spotify.com/search/{q}",
    Provider.BANDCAMP: "https://bandcamp.com/search?q={q}&item_type=t",
    Provider.SOUNDCLOUD: "https://soundcloud.com/search/sounds?q={q}",
}


@dataclass
class SearchTokens:
    """The cached service credentials, built once so every search reuses one token."""

    apple_music: AppleMusicToken | None
    tidal: TidalToken | None

    @classmethod
    def from_settings(cls, settings: Settings) -> SearchTokens:
        """Build a token for each service whose credentials are complete.

        Args:
            settings: The API settings.

        Returns:
            SearchTokens: A token per configured service, None for the rest.
        """
        apple = (
            AppleMusicToken(
                team_id=settings.apple_music_team_id,
                key_id=settings.apple_music_key_id,
                private_key=settings.apple_music_private_key.get_secret_value(),
            )
            if settings.apple_music_configured
            else None
        )
        tidal_token = (
            TidalToken(
                client_id=settings.tidal_client_id,
                client_secret=settings.tidal_client_secret.get_secret_value(),
            )
            if settings.tidal_configured
            else None
        )
        return cls(apple_music=apple, tidal=tidal_token)


def search_url(provider: Provider, query: str, country: str) -> str:
    """Return the service's own search page for the query, the fallback for every group.

    Args:
        provider: A searchable provider.
        query: The search text.
        country: The two-letter country code; Apple Music uses it as the storefront.

    Returns:
        str: The search page URL, with the query percent-encoded.

    Raises:
        KeyError: If the provider is not searchable.
    """
    return _SEARCH_URLS[provider].format(q=quote(query, safe=""), country=country.lower())


def adapters(settings: Settings, tokens: SearchTokens, backoff: Backoff) -> dict[Provider, Adapter]:
    """Return the inline search for each service that can answer one, in group order.

    A service with no adapter, or whose credentials are unset, is absent and answers with
    its search page only.

    Args:
        settings: The API settings.
        tokens: The cached credentials built from the same settings.
        backoff: The shared rate-limit holds, for adapters that make more than one request.

    Returns:
        dict[Provider, Adapter]: The configured adapters.
    """
    found: dict[Provider, Adapter] = {}
    if settings.apple_music_configured and tokens.apple_music is not None:
        found[Provider.APPLE_MUSIC] = apple_music.adapter(tokens.apple_music)
    if settings.tidal_configured and tokens.tidal is not None:
        found[Provider.TIDAL] = tidal.adapter(tokens.tidal, backoff)
    found[Provider.INTERNET_ARCHIVE] = internet_archive.search
    return found
