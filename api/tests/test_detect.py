"""Provider detection is a pure function of the URL."""

import pytest

from crosstune.links.detect import detect_provider, normalize_url


@pytest.mark.parametrize(
    ("url", "provider", "ref"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ?t=42", "youtube", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
        ("https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
        (
            "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp",
            "spotify",
            "track:3n3Ppam7vgaVa1iaRUc9Lp",
        ),
        (
            "https://open.spotify.com/intl-de/album/1ATL5GLyefJaxhQzSPVrLX",
            "spotify",
            "album:1ATL5GLyefJaxhQzSPVrLX",
        ),
        (
            "https://music.apple.com/us/album/angeline-the-baker/1440935467?i=1440935474",
            "apple_music",
            "1440935474",
        ),
        (
            "https://music.apple.com/us/album/old-time-fiddle/1440935467",
            "apple_music",
            "1440935467",
        ),
        ("https://fiddler.bandcamp.com/track/sally-ann", "bandcamp", None),
        ("https://soundcloud.com/someone/some-tune", "soundcloud", None),
        ("https://tidal.com/track/45670321/u", "tidal", "track:45670321"),
        ("https://tidal.com/browse/album/45670320", "tidal", "album:45670320"),
        (
            "https://listen.tidal.com/album/45670320/track/45670321",
            "tidal",
            "track:45670321",
        ),
        (
            "https://tidal.com/playlist/748d84d2-37dc-4900-9bc5-68d8ac89d354",
            "tidal",
            "playlist:748d84d2-37dc-4900-9bc5-68d8ac89d354",
        ),
        ("https://tidal.com/video/97770920", "tidal", "video:97770920"),
        ("https://tidal.com/artist/4831953", "tidal", None),
        ("https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x", "youtube", "dQw4w9WgXcQ"),
        (
            "https://archive.org/details/78_soldiers-joy_sleepy-marlin_gbia0506187b",
            "internet_archive",
            "78_soldiers-joy_sleepy-marlin_gbia0506187b",
        ),
        (
            "https://archive.org/details/afc1937001_1535B2/track01.mp3",
            "internet_archive",
            "afc1937001_1535B2",
        ),
        ("https://archive.org/search?query=fiddle", "internet_archive", None),
        ("https://example.com/recording.mp3", "other", None),
        ("not a url", "other", None),
    ],
)
def test_detect_provider(url: str, provider: str, ref: str | None) -> None:
    assert detect_provider(url) == (provider, ref)


def test_normalize_youtube_to_canonical_watch_url() -> None:
    assert normalize_url("https://youtu.be/dQw4w9WgXcQ?t=42", "youtube", "dQw4w9WgXcQ") == (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    )


def test_normalize_strips_tracking_params_for_others() -> None:
    assert (
        normalize_url(
            "https://fiddler.bandcamp.com/track/sally-ann?utm_source=x&from=embed", "bandcamp", None
        )
        == "https://fiddler.bandcamp.com/track/sally-ann?from=embed"
    )


@pytest.mark.parametrize(
    ("url", "provider", "ref", "expected"),
    [
        (
            "https://listen.tidal.com/album/1/track/45670321?u",
            "tidal",
            "track:45670321",
            "https://tidal.com/track/45670321",
        ),
        (
            "https://archive.org/details/afc1937001_1535B2/track01.mp3",
            "internet_archive",
            "afc1937001_1535B2",
            "https://archive.org/details/afc1937001_1535B2",
        ),
        (
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x",
            "youtube",
            "dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        ),
    ],
)
def test_normalize_collapses_tidal_and_archive_urls(
    url: str, provider: str, ref: str, expected: str
) -> None:
    assert normalize_url(url, provider, ref) == expected


@pytest.mark.parametrize("url", ["http://[abc", "https://a]b.com/x"])
def test_a_url_the_parser_rejects_is_other_and_kept_as_pasted(url: str) -> None:
    # urlparse raises on an unbalanced IPv6 bracket; neither function may let that escape.
    assert detect_provider(url) == ("other", None)
    assert normalize_url(url, "other", None) == url
