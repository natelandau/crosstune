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
