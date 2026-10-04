"""Identify the streaming provider from a pasted URL."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from crosstune.vocabulary import LIMITS

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
SLIPPERY_HILL_ORIGIN = "https://www.slippery-hill.com"
SLIPPERY_HILL_FILES = "/system/files/"
SLIPPERY_HILL_REF = re.compile(r"(?:[A-Za-z0-9_~%()!*'+,.-]+/)*[A-Za-z0-9_~%()!*'+,.-]+(?i:\.mp3)")
SLIPPERY_HILL_PAGE = re.compile(r"/content/([A-Za-z0-9-]+)/?")
MAX_REF = LIMITS["recording_links"]["provider_ref"]
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


def valid_slippery_hill_ref(ref: str) -> bool:
    """Report whether `ref` is a safe file path under Slippery-Hill's `/system/files/`."""
    if not SLIPPERY_HILL_REF.fullmatch(ref):
        return False
    # Clients append the ref to the origin, so a dot segment, however it is spelled, could
    # climb out of the files tree.
    return "%2e" not in ref.lower() and not {".", ".."} & set(ref.split("/"))


def slippery_hill_ref(path: str) -> str | None:
    """Return the file path under `/system/files/` for a Slippery-Hill MP3, else None.

    Args:
        path: The percent-encoded URL path.
    """
    if not path.startswith(SLIPPERY_HILL_FILES):
        return None
    ref = path[len(SLIPPERY_HILL_FILES) :]
    return ref if valid_slippery_hill_ref(ref) else None


def slippery_hill_file_url(ref: str) -> str:
    """Return the canonical URL of a Slippery-Hill file ref."""
    return f"{SLIPPERY_HILL_ORIGIN}{SLIPPERY_HILL_FILES}{ref}"


def _slippery_hill_ref(parts: ParseResult) -> str | None:
    return slippery_hill_ref(parts.path)


def _slippery_hill_url(parts: ParseResult, ref: str | None) -> str | None:
    if ref:
        return slippery_hill_file_url(ref)
    page = SLIPPERY_HILL_PAGE.fullmatch(parts.path)
    return f"{SLIPPERY_HILL_ORIGIN}/content/{page.group(1)}" if page else None


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
    (lambda host: host == "slippery-hill.com", "slippery_hill", _slippery_hill_ref),
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
            ref = ref_of(parts) if ref_of else None
            return provider, ref if ref is None or len(ref) <= MAX_REF else None
    return "other", None


def normalize_url(url: str, provider: str, provider_ref: str | None) -> str:
    """Canonical form for storage.

    YouTube, TIDAL, Internet Archive, and Slippery-Hill file and tune page URLs collapse
    to one URL per recording; all others drop their tracking parameters.
    """
    if provider == "youtube" and provider_ref:
        return f"https://www.youtube.com/watch?v={provider_ref}"
    if provider == "tidal" and provider_ref:
        kind, _, item_id = provider_ref.partition(":")
        return f"https://tidal.com/{kind}/{item_id}"
    if provider == "internet_archive" and provider_ref:
        return f"https://archive.org/details/{provider_ref}"
    try:
        parts = urlparse(url)
    except ValueError:
        # The parser rejects some strings outright, an unclosed IPv6 bracket among them.
        # Such a link is stored as pasted rather than refused.
        return url
    if provider == "slippery_hill" and (canonical := _slippery_hill_url(parts, provider_ref)):
        return canonical
    kept = [
        (k, v)
        for k, v in parse_qs(parts.query, keep_blank_values=True).items()
        if k not in TRACKING_PARAMS
    ]
    query = urlencode([(k, v[0]) for k, v in kept])
    return urlunparse(parts._replace(query=query, fragment=""))
