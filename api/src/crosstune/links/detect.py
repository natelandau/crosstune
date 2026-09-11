"""Identify the streaming provider from a pasted URL."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

if TYPE_CHECKING:
    from collections.abc import Callable
    from urllib.parse import ParseResult

YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
SPOTIFY_PATH = re.compile(r"^/(?:intl-[a-z]{2}/)?(track|album|episode|playlist)/([A-Za-z0-9]+)")
TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "si",
    "feature",
}


def _valid_youtube(candidate: str) -> str | None:
    return candidate if YOUTUBE_ID.match(candidate) else None


def _youtube_watch_ref(parts: ParseResult) -> str | None:
    if parts.path == "/watch":
        return _valid_youtube(parse_qs(parts.query).get("v", [""])[0])
    for prefix in ("/shorts/", "/embed/", "/live/"):
        if parts.path.startswith(prefix):
            return _valid_youtube(parts.path[len(prefix) :].split("/", 1)[0])
    return None


def _youtube_short_ref(parts: ParseResult) -> str | None:
    return _valid_youtube(parts.path.strip("/"))


def _spotify_ref(parts: ParseResult) -> str | None:
    match = SPOTIFY_PATH.match(parts.path)
    return f"{match.group(1)}:{match.group(2)}" if match else None


def _apple_music_ref(parts: ParseResult) -> str | None:
    query = parse_qs(parts.query)
    if "i" in query:
        return query["i"][0]
    last = parts.path.rstrip("/").rsplit("/", 1)[-1]
    return last if last.isdigit() else None


def _is_bandcamp(host: str) -> bool:
    return host == "bandcamp.com" or host.endswith(".bandcamp.com")


# Host match, provider name, and how to pull a provider_ref out of the parsed URL.
# None means the provider has no ref to extract.
_PROVIDER_MATCHERS: tuple[
    tuple[Callable[[str], bool], str, Callable[[ParseResult], str | None] | None], ...
] = (
    (lambda host: host in {"youtube.com", "youtube-nocookie.com"}, "youtube", _youtube_watch_ref),
    (lambda host: host == "youtu.be", "youtube", _youtube_short_ref),
    (lambda host: host == "open.spotify.com", "spotify", _spotify_ref),
    (lambda host: host == "music.apple.com", "apple_music", _apple_music_ref),
    (_is_bandcamp, "bandcamp", None),
    (lambda host: host == "soundcloud.com", "soundcloud", None),
)


def _canonical_host(url: str) -> tuple[ParseResult | None, str]:
    try:
        parts = urlparse(url)
    except ValueError:
        return None, ""
    host = (parts.hostname or "").lower()
    if host.startswith(("www.", "m.")):
        host = host.split(".", 1)[1]
    return parts, host


def detect_provider(url: str) -> tuple[str, str | None]:
    """Return (provider, provider_ref). Unknown or malformed URLs are ("other", None)."""
    parts, host = _canonical_host(url)
    if parts is None:
        return "other", None
    for matches_host, provider, ref_of in _PROVIDER_MATCHERS:
        if matches_host(host):
            return provider, ref_of(parts) if ref_of else None
    return "other", None


def normalize_url(url: str, provider: str, provider_ref: str | None) -> str:
    """Canonical form for storage. YouTube collapses to the watch URL; others drop tracking params."""
    if provider == "youtube" and provider_ref:
        return f"https://www.youtube.com/watch?v={provider_ref}"
    parts = urlparse(url)
    kept = [
        (k, v)
        for k, v in parse_qs(parts.query, keep_blank_values=True).items()
        if k not in TRACKING_PARAMS
    ]
    query = urlencode([(k, v[0]) for k, v in kept])
    return urlunparse(parts._replace(query=query, fragment=""))
