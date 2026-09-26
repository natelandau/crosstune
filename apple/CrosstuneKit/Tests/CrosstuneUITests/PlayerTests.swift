import CrosstuneStore
import Foundation
import Testing

@testable import CrosstuneUI

#if os(macOS)
    import AppKit
    import WebKit
#endif

private func link(_ provider: String, _ providerRef: String?, url: String = "https://example.com/x") -> RecordingLink {
    RecordingLink(id: "l1", tuneID: "t1", url: url, provider: provider, providerRef: providerRef)
}

@Suite struct EmbedTests {
    @Test(arguments: [
        (
            link("youtube", "dQw4w9WgXcQ"),
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1", Embed.Height.video
        ),
        (
            link("spotify", "track:403iATVGis7FqKA0BcTSRt"),
            "https://open.spotify.com/embed/track/403iATVGis7FqKA0BcTSRt", .points(152)
        ),
        (
            link("spotify", "episode:4rOoJ6Egrf8K2IrywzwOMk"),
            "https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk", .points(152)
        ),
        (
            link("spotify", "album:1DFixLWuPkv3KT3TnV35m3"),
            "https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3", .points(152)
        ),
        (
            link("spotify", "playlist:37i9dQZF1DXcBWIGoYBM5M"),
            "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M", .points(152)
        ),
        (
            link(
                "apple_music", "148243927",
                url: "https://music.apple.com/us/album/roaring-river/148243382?i=148243927"),
            "https://embed.music.apple.com/us/album/roaring-river/148243382?i=148243927", .points(175)
        ),
        (
            link("apple_music", nil, url: "https://music.apple.com/us/song/roaring-river/148243927"),
            "https://embed.music.apple.com/us/song/roaring-river/148243927", .points(175)
        ),
        (
            link("apple_music", "148243382", url: "https://music.apple.com/us/album/roaring-river/148243382"),
            "https://embed.music.apple.com/us/album/roaring-river/148243382", .points(175)
        ),
        (
            link("apple_music", nil, url: "http://music.apple.com/us/song/roaring-river/148243927"),
            "https://embed.music.apple.com/us/song/roaring-river/148243927", .points(175)
        ),
        (link("tidal", "track:45670321"), "https://embed.tidal.com/tracks/45670321", .points(120)),
        (link("tidal", "album:45670320"), "https://embed.tidal.com/albums/45670320", .points(150)),
        (
            link("tidal", "playlist:748d84d2-37dc-4900-9bc5-68d8ac89d354"),
            "https://embed.tidal.com/playlists/748d84d2-37dc-4900-9bc5-68d8ac89d354", .points(150)
        ),
        (link("tidal", "video:97770920"), "https://embed.tidal.com/videos/97770920", .video),
        (
            link("soundcloud", nil, url: "https://soundcloud.com/someone/some-tune"),
            "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fsome-tune", .points(166)
        ),
        (
            link("soundcloud", nil, url: "https://soundcloud.com/someone/sets/jam"),
            "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fsets%2Fjam", .points(166)
        ),
        (
            link("bandcamp", "album:84352595"),
            "https://bandcamp.com/EmbeddedPlayer/album=84352595/size=large/artwork=small/tracklist=false/transparent=true/",
            .points(120)
        ),
        (
            link("bandcamp", "track:2417374"),
            "https://bandcamp.com/EmbeddedPlayer/track=2417374/size=large/artwork=small/tracklist=false/transparent=true/",
            .points(120)
        ),
        (
            link("internet_archive", "78_soldiers-joy_sleepy-marlin_gbia0506187b"),
            "https://archive.org/embed/78_soldiers-joy_sleepy-marlin_gbia0506187b", .points(60)
        ),
    ])
    func buildsTheProvidersPlayer(link: RecordingLink, src: String, height: Embed.Height) throws {
        let embed = try #require(Embed.for(link))
        #expect(embed.src == src)
        #expect(embed.height == height)
        #expect(embed.allow == allows[link.provider])
    }

    /// Each provider's `allow` list, as the web's embed module writes it.
    private let allows = [
        "youtube": "autoplay; encrypted-media; picture-in-picture; fullscreen",
        "spotify": "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
        "apple_music": "autoplay *; encrypted-media *",
        "tidal": "autoplay; encrypted-media; fullscreen; clipboard-write https://embed.tidal.com; web-share",
        "soundcloud": "autoplay; encrypted-media",
        "bandcamp": "autoplay; encrypted-media",
        "internet_archive": "autoplay; encrypted-media; fullscreen",
    ]

    @Test func normalizesAnAppleMusicAddressAsABrowserDoes() {
        #expect(
            Embed.for(link("apple_music", nil, url: "https://music.apple.com"))?.src
                == "https://embed.music.apple.com/")
        #expect(
            Embed.for(link("apple_music", nil, url: "https://Music.Apple.com/us/album/café tune/1?i=2"))?.src
                == "https://embed.music.apple.com/us/album/caf%C3%A9%20tune/1?i=2")
    }

    @Test func addsAutoplayToTheYouTubeSourceOnlyWhenAsked() {
        let youtube = link("youtube", "dQw4w9WgXcQ")
        #expect(Embed.for(youtube)?.src == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1")
        #expect(
            Embed.for(youtube, autoplay: true)?.src
                == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&autoplay=1")
    }

    @Test func addsAutoPlayToTheSoundCloudSourceOnlyWhenAsked() {
        let soundcloud = link("soundcloud", nil, url: "https://soundcloud.com/someone/some-tune")
        #expect(
            Embed.for(soundcloud)?.src
                == "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fsome-tune")
        #expect(
            Embed.for(soundcloud, autoplay: true)?.src
                == "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fsome-tune&auto_play=true"
        )
    }

    @Test func sandboxesTheAppleMusicAndTidalPlayersAsTheirOwnEmbedCodeDoes() {
        #expect(
            Embed.for(link("apple_music", "1", url: "https://music.apple.com/us/album/x/1?i=2"))?.sandbox
                == "allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
        )
        #expect(
            Embed.for(link("tidal", "track:1"))?.sandbox
                == "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox")
        #expect(Embed.for(link("spotify", "track:1"))?.sandbox == nil)
    }

    @Test(arguments: [
        link("youtube", "short"),
        link("spotify", nil),
        link("apple_music", "1", url: "https://example.com/album/1"),
        link("apple_music", "1", url: "not a url"),
        link("tidal", nil),
        link("tidal", "artist:1"),
        link("soundcloud", nil, url: "https://example.com/a/b"),
        link("soundcloud", nil, url: "not a url"),
        link("bandcamp", nil),
        link("internet_archive", nil),
        link("other", nil),
        link("napster", "track:1"),
    ])
    func hasNoPlayerFor(link: RecordingLink) {
        #expect(Embed.for(link) == nil)
    }

    @Test func readsAVideoAsTwoHundredPointsTall() {
        #expect(Embed.for(link("youtube", "dQw4w9WgXcQ"))?.points == 200)
        #expect(Embed.for(link("spotify", "track:1"))?.points == 152)
    }

    @Test func framesThePlayerWithItsPermissionsEscaped() throws {
        let embed = try #require(
            Embed.for(link("soundcloud", nil, url: "https://soundcloud.com/someone/some-tune"), autoplay: true))
        let page = embed.document
        #expect(
            page.contains(
                #"src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fsome-tune&amp;auto_play=true""#
            ))
        #expect(page.contains(#"allow="autoplay; encrypted-media""#))
        #expect(!page.contains("sandbox="))
        let tidal = try #require(Embed.for(link("tidal", "track:1"))).document
        #expect(tidal.contains(#"sandbox="allow-same-origin allow-scripts"#))
    }

    @Test func namesThePageAfterTheAppSoProvidersSeeAReferrer() {
        #expect(
            Embed.documentOrigin(bundleID: "app.crosstune.Crosstune").absoluteString
                == "https://app.crosstune.crosstune")
        #expect(Embed.documentOrigin(bundleID: nil).absoluteString == "https://app.crosstune.crosstune")
    }
}

@Suite struct PlayerItemLinkTests {
    @Test func loadsALinkWithItsPlayerStartingAndItsProviderPage() throws {
        var youtube = link("youtube", "dQw4w9WgXcQ", url: "https://youtu.be/dQw4w9WgXcQ")
        youtube.title = "Soldier's Joy"
        let item = try #require(PlayerItem.link(youtube))
        #expect(item.kind == .link)
        #expect(item.id == "l1")
        #expect(item.title == "Soldier's Joy")
        #expect(item.link?.embed.src.hasSuffix("&autoplay=1") == true)
        #expect(item.link?.providerName == "YouTube")
        #expect(item.link?.providerURL == URL(string: "https://youtu.be/dQw4w9WgXcQ"))
    }

    @Test func refusesALinkWithNoPlayerOrOneThatIsDeleted() {
        #expect(PlayerItem.link(link("other", nil)) == nil)
        var deleted = link("youtube", "dQw4w9WgXcQ")
        deleted.deletedAt = .now
        #expect(PlayerItem.link(deleted) == nil)
    }
}

@MainActor
@Suite struct PlayerModelTests {
    private func youtube(title: String? = "Soldier's Joy") -> RecordingLink {
        var row = link("youtube", "dQw4w9WgXcQ")
        row.title = title
        return row
    }

    @Test func holdsOneItemAtATimeAndCloses() throws {
        let player = PlayerModel()
        #expect(!player.isLoaded)
        player.play(try #require(PlayerItem.link(youtube())))
        #expect(player.isLoaded)
        #expect(player.holds(.link, id: "l1"))
        player.play(PlayerItem(kind: .recording, id: "r1", title: "Kitchen Girl"))
        #expect(player.title == "Kitchen Girl")
        #expect(!player.holds(.link, id: "l1"))
        // A recording and a link never share an item, even with the same id.
        #expect(player.holds(.recording, id: "r1") && !player.holds(.link, id: "r1"))
        player.close()
        #expect(!player.isLoaded)
        #expect(player.title == nil)
    }

    @Test func showsALinksPlayerInFullOnPlayAndARecordingsOnlyWhenAsked() throws {
        let player = PlayerModel()
        player.play(try #require(PlayerItem.link(youtube())))
        #expect(player.isExpanded)
        player.isExpanded = false
        player.expand()
        #expect(player.isExpanded)

        player.play(PlayerItem(kind: .recording, id: "r1", title: "Kitchen Girl"))
        #expect(!player.isExpanded)
        player.expand()
        #expect(player.isExpanded)

        player.play(try #require(PlayerItem.link(youtube())))
        player.close()
        #expect(!player.isExpanded)
    }

    @Test func followsTheLoadedLinksRow() throws {
        let player = PlayerModel()
        player.play(try #require(PlayerItem.link(youtube(title: nil))))
        player.isExpanded = false

        player.linkChanged(id: "l1", to: youtube(title: "Resolved title"))
        #expect(player.title == "Resolved title")
        #expect(player.isLoaded)
        #expect(!player.isExpanded)

        // Another link's row changing leaves the loaded one alone.
        player.linkChanged(id: "l2", to: nil)
        #expect(player.isLoaded)
    }

    @Test(arguments: [Optional<RecordingLink>.none, link("other", nil)])
    func closesWhenTheLoadedLinkIsGoneOrHasNoPlayer(row: RecordingLink?) throws {
        let player = PlayerModel()
        player.play(try #require(PlayerItem.link(youtube())))
        player.linkChanged(id: "l1", to: row)
        #expect(!player.isLoaded)
    }

    @Test func closesWhenTheLoadedLinkIsDeleted() throws {
        let player = PlayerModel()
        player.play(try #require(PlayerItem.link(youtube())))
        var deleted = youtube()
        deleted.deletedAt = .now
        player.linkChanged(id: "l1", to: deleted)
        #expect(!player.isLoaded)
    }

    @Test func leavesALoadedRecordingAloneWhenALinkChanges() {
        let player = PlayerModel()
        player.play(PlayerItem(kind: .recording, id: "l1", title: "Kitchen Girl"))
        player.linkChanged(id: "l1", to: nil)
        #expect(player.holds(.recording, id: "l1"))
    }
}

#if os(macOS)
    @MainActor
    @Suite struct EmbedStageTests {
        private let embed = Embed.for(link("youtube", "dQw4w9WgXcQ"), autoplay: true)!

        private func webView(in host: NSView) -> WKWebView? {
            host.subviews.first as? WKWebView
        }

        @Test func givesTheWebViewToTheShownHostWhateverOrderTheyArrive() {
            let stage = EmbedStage()
            let parked = NSView()
            let shown = NSView()
            stage.attach(shown, embed: embed, prominence: .shown)
            stage.attach(parked, embed: embed, prominence: .parked)
            #expect(webView(in: shown) != nil)
            #expect(webView(in: parked) == nil)

            let other = EmbedStage()
            let parkedFirst = NSView()
            let shownSecond = NSView()
            other.attach(parkedFirst, embed: embed, prominence: .parked)
            other.attach(shownSecond, embed: embed, prominence: .shown)
            #expect(webView(in: shownSecond) != nil)
        }

        @Test func movesTheSameWebViewBackWhenTheShownHostLeaves() throws {
            let stage = EmbedStage()
            let parked = NSView()
            let shown = NSView()
            stage.attach(parked, embed: embed, prominence: .parked)
            stage.attach(shown, embed: embed, prominence: .shown)
            let playing = try #require(webView(in: shown))
            stage.detach(shown)
            #expect(webView(in: parked) === playing)
        }

        @Test func playsOnceAcrossWindowsInTheWindowInUse() throws {
            let stage = EmbedStage()
            let first = NSView()
            let second = NSView()
            stage.attach(first, embed: embed, prominence: .shown)
            stage.attach(second, embed: embed, prominence: .shown)
            let playing = try #require(webView(in: second))
            #expect(webView(in: first) == nil)

            stage.rank(first, prominence: .focused)
            #expect(webView(in: first) === playing)
            #expect(webView(in: second) == nil)

            stage.rank(first, prominence: .shown)
            stage.rank(second, prominence: .focused)
            #expect(webView(in: second) === playing)
            #expect(webView(in: first) == nil)
        }

        @Test func keepsTheWebViewThroughALayoutSwitchAndTearsItDownOnClose() async throws {
            let stage = EmbedStage()
            let phone = NSView()
            stage.attach(phone, embed: embed, prominence: .shown)
            let playing = try #require(webView(in: phone))

            // The old layout's host leaves and the new one's arrives in the same update.
            stage.detach(phone)
            let split = NSView()
            stage.attach(split, embed: embed, prominence: .shown)
            await Task.yield()
            #expect(webView(in: split) === playing)

            stage.detach(split)
            try await Task.sleep(for: .milliseconds(20))
            #expect(webView(in: split) == nil)
        }
    }
#endif

@Suite struct PlayerPanelSizeTests {
    private let video = Embed.for(link("youtube", "dQw4w9WgXcQ"))!
    private let spotify = Embed.for(link("spotify", "track:1"))!

    @Test func keepsTheFullSizeWhenTheWindowHasRoom() {
        let size = PlayerPanel.embedSize(video, windowHeight: 1000)
        #expect(size.height == 200)
        #expect(size.width == 356)
        #expect(PlayerPanel.embedSize(spotify, windowHeight: 1000).height == 152)
        #expect(PlayerPanel.embedSize(spotify, windowHeight: 1000).width == nil)
    }

    @Test func shrinksToFortyPercentOfAShortWindowKeepingAVideosShape() {
        // A landscape iPhone Pro Max: 440 points tall.
        let size = PlayerPanel.embedSize(video, windowHeight: 440)
        let panel = size.height + PlayerPanel.chrome
        #expect(abs(panel - 440 * 0.4) < 0.001)
        #expect(abs(size.width! / size.height - 356.0 / 200.0) < 0.001)
        #expect(PlayerPanel.embedSize(spotify, windowHeight: 300).height == 300 * 0.4 - PlayerPanel.chrome)
    }

    @Test func keepsTheFullSizeBeforeTheWindowIsMeasured() {
        let size = PlayerPanel.embedSize(video, windowHeight: .infinity)
        #expect(size.height == 200)
        #expect(size.width == 356)
        #expect(PlayerPanel.embedSize(spotify, windowHeight: .infinity).height == 152)
    }

    @Test func leavesOnlyTheBarInAWindowTooShortForAPlayer() {
        #expect(PlayerPanel.embedSize(video, windowHeight: 100).height == 0)
    }
}
