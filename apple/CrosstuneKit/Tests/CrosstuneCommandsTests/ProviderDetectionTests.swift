import Testing

@testable import CrosstuneCommands

@Suite struct DetectProviderTests {
    @Test(
        arguments: [
            ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "youtube", "dQw4w9WgXcQ"),
            ("https://youtu.be/dQw4w9WgXcQ?si=abc", "youtube", "dQw4w9WgXcQ"),
            ("https://m.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
            ("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "spotify", "track:4uLU6hMCjMI75M1A2tKUQC"),
            ("https://open.spotify.com/intl-de/album/1A2B", "spotify", "album:1A2B"),
            ("https://music.apple.com/us/album/x/123?i=456", "apple_music", "456"),
            ("https://music.apple.com/us/album/x/123", "apple_music", "123"),
            // A fullwidth digit is Unicode-numeric but not ASCII, so it fails the digits-only
            // check, matching the web's ASCII-only `\d`.
            ("https://music.apple.com/us/album/x/\u{FF11}\u{FF12}\u{FF13}", "apple_music", nil),
            ("https://someone.bandcamp.com/track/y", "bandcamp", nil),
            ("https://soundcloud.com/a/b", "soundcloud", nil),
            ("https://tidal.com/track/45670321/u", "tidal", "track:45670321"),
            ("https://tidal.com/browse/album/45670320", "tidal", "album:45670320"),
            ("https://listen.tidal.com/album/45670320/track/45670321", "tidal", "track:45670321"),
            (
                "https://tidal.com/playlist/748d84d2-37dc-4900-9bc5-68d8ac89d354", "tidal",
                "playlist:748d84d2-37dc-4900-9bc5-68d8ac89d354"
            ),
            ("https://tidal.com/video/97770920", "tidal", "video:97770920"),
            ("https://tidal.com/artist/4831953", "tidal", nil),
            ("https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x", "youtube", "dQw4w9WgXcQ"),
            (
                "https://archive.org/details/78_soldiers-joy_sleepy-marlin_gbia0506187b", "internet_archive",
                "78_soldiers-joy_sleepy-marlin_gbia0506187b"
            ),
            ("https://archive.org/details/afc1937001_1535B2/track01.mp3", "internet_archive", "afc1937001_1535B2"),
            ("https://archive.org/search?query=fiddle", "internet_archive", nil),
            ("https://example.com/tune.mp3", "other", nil),
            ("not a url", "other", nil),
        ] as [(String, String, String?)]
    )
    func detects(url: String, provider: String, providerRef: String?) {
        let result = detectProvider(url)
        #expect(result.provider == provider)
        #expect(result.providerRef == providerRef)
    }
}

@Suite struct YoutubeIDTests {
    @Test func extractsAPlayableIDOnlyForYoutubeLinks() {
        #expect(youtubeID(provider: "youtube", providerRef: "dQw4w9WgXcQ") == "dQw4w9WgXcQ")
        #expect(youtubeID(provider: "spotify", providerRef: "track:x") == nil)
    }
}

@Suite struct AppleMusicKindTests {
    @Test(
        arguments: [
            ("https://music.apple.com/us/album/the-silver-spear/1440833081?i=1440833090", .song(id: "1440833090")),
            ("https://music.apple.com/gb/song/the-silver-spear/1440833090", .song(id: "1440833090")),
            ("https://music.apple.com/us/album/reels/1440833081", .album(id: "1440833081")),
            ("https://music.apple.com/us/album/reels/1440833081/", .album(id: "1440833081")),
            ("https://music.apple.com/album/reels/1440833081", .album(id: "1440833081")),
            ("https://music.apple.com/song/the-silver-spear/1440833090", .song(id: "1440833090")),
            ("https://music.apple.com/us/music-video/x/1440833099", nil),
            ("https://music.apple.com/us/playlist/x/pl.u-abc", nil),
            ("https://music.apple.com/us/artist/x/12345", nil),
            ("https://open.spotify.com/track/abc", nil),
            ("not a url", nil),
        ] as [(String, AppleMusicKind?)]
    )
    func readsTheKind(url: String, expected: AppleMusicKind?) {
        #expect(appleMusicKind(url) == expected)
    }

    @Test func agreesWithTheStoredReference() {
        let url = "https://music.apple.com/us/album/reels/1440833081?i=1440833090"
        guard case .song(let id) = appleMusicKind(url) else {
            Issue.record("not a song")
            return
        }
        #expect(id == detectProvider(url).providerRef)
    }
}
