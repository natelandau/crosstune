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
# listen.tidal.com nests a track under its album; the track is the recording.
TIDAL_PATH = re.compile(
    r"^/(?:browse/)?(?:album/\d+/)?(track|album|playlist|video)/([0-9A-Fa-f-]+)"
)
ARCHIVE_PATH = re.compile(r"^/details/([A-Za-z0-9._-]+)")
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


def _typed_ref(pattern: re.Pattern[str]) -> Callable[[ParseResult], str | None]:
    def ref(parts: ParseResult) -> str | None:
        match = pattern.match(parts.path)
        return f"{match.group(1)}:{match.group(2)}" if match else None

    return ref


def _archive_ref(parts: ParseResult) -> str | None:
    match = ARCHIVE_PATH.match(parts.path)
    return match.group(1) if match else None


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
    (
        lambda host: host in {"youtube.com", "youtube-nocookie.com", "music.youtube.com"},
        "youtube",
        _youtube_watch_ref,
    ),
    (lambda host: host == "youtu.be", "youtube", _youtube_short_ref),
    (lambda host: host == "open.spotify.com", "spotify", _typed_ref(SPOTIFY_PATH)),
    (lambda host: host == "music.apple.com", "apple_music", _apple_music_ref),
    (_is_bandcamp, "bandcamp", None),
    (lambda host: host == "soundcloud.com", "soundcloud", None),
    (lambda host: host in {"tidal.com", "listen.tidal.com"}, "tidal", _typed_ref(TIDAL_PATH)),
    (lambda host: host == "archive.org", "internet_archive", _archive_ref),
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
    """Canonical form for storage.

    YouTube, TIDAL, and Internet Archive URLs collapse to one URL per recording; all others
    drop their tracking parameters.
    """
    if provider == "youtube" and provider_ref:
        return f"https://www.youtube.com/watch?v={provider_ref}"
    if provider == "tidal" and provider_ref:
        kind, _, item_id = provider_ref.partition(":")
        return f"https://tidal.com/{kind}/{item_id}"
    if provider == "internet_archive" and provider_ref:
        return f"https://archive.org/details/{provider_ref}"
    parts = urlparse(url)
    kept = [
        (k, v)
        for k, v in parse_qs(parts.query, keep_blank_values=True).items()
        if k not in TRACKING_PARAMS
    ]
    query = urlencode([(k, v[0]) for k, v in kept])
    return urlunparse(parts._replace(query=query, fragment=""))
