import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
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
        (
            link("slippery_hill", "recordings/a.mp3"),
            "https://www.slippery-hill.com/system/files/recordings/a.mp3", .points(60)
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
        "slippery_hill": "autoplay",
    ]

    @Test func slipperyHillPlaysInAnAudioElement() throws {
        let embed = try #require(Embed.for(link("slippery_hill", "recordings/a.mp3")))
        #expect(embed.kind == .audio)
        #expect(embed.document.contains("<audio"))
        #expect(embed.document.contains(embed.src))
        #expect(!embed.document.contains("<iframe"))
        #expect(Embed.for(link("youtube", "dQw4w9WgXcQ"))?.kind == .frame)
    }

    @Test func theAudioElementIsNamedForTheRecording() throws {
        let titled = RecordingLink(
            id: "l1", tuneID: "t1", url: "https://example.com/x", provider: "slippery_hill",
            providerRef: "recordings/a.mp3", title: "Bear Creek Sally Goodin - Bob Holt")
        let page = try #require(Embed.for(titled)).document
        #expect(page.contains("aria-label=\"Bear Creek Sally Goodin - Bob Holt\""))

        let tricky = try #require(
            Embed.for(provider: "slippery_hill", providerRef: "a.mp3", url: "", title: "\"A\" <b>"))
        #expect(tricky.document.contains("aria-label=\"&quot;A&quot; &lt;b&gt;\""))

        let untitled = try #require(Embed.for(provider: "slippery_hill", providerRef: "a.mp3", url: ""))
        #expect(untitled.document.contains("aria-label=\"\(Embed.untitledPlayer)\""))
    }

    @Test func aNewTitleDoesNotMakeAnotherPlayer() throws {
        let one = try #require(Embed.for(provider: "slippery_hill", providerRef: "a.mp3", url: "", title: "One"))
        let two = try #require(Embed.for(provider: "slippery_hill", providerRef: "a.mp3", url: "", title: "Two"))
        #expect(one == two)
    }

    @Test(arguments: [nil, "../x.mp3", "a/%2E%2E/x.mp3", "a/./x.mp3", "a/x.wav"] as [String?])
    func slipperyHillHasNoPlayerWithoutASafeRef(ref: String?) {
        #expect(Embed.for(link("slippery_hill", ref)) == nil)
    }

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

#if os(macOS)
    @Suite struct PlayerDockTests {
        @Test func dockEmbedStaysWithinShare() {
            #expect(PlayerDock.chrome == MacStyle.dockHeight + PlayerDock.inset)
            let height = PlayerDock.embedHeight(columnHeight: 500, wanted: 400)
            #expect(height == 500 * PlayerDock.maxShare - PlayerDock.chrome)
            #expect(height + PlayerDock.chrome <= 500 * PlayerDock.maxShare)
            #expect(PlayerDock.embedHeight(columnHeight: 1000, wanted: 152) == 152)
        }

        @Test func leavesOnlyTheBarInAColumnTooShortForAPlayer() {
            #expect(PlayerDock.embedHeight(columnHeight: 100, wanted: 200) == 0)
        }

        @Test func keepsTheFullSizeBeforeTheColumnIsMeasured() {
            #expect(PlayerDock.embedHeight(columnHeight: .infinity, wanted: 200) == 200)
        }
    }
#endif

@Suite struct ScrubberStepTests {
    @Test func movesByTheKeyStep() {
        #expect(PlaybackScrubber.keyStep == 5)
        #expect(PlaybackScrubber.stepped(60, by: PlaybackScrubber.keyStep, length: 184) == 65)
        #expect(PlaybackScrubber.stepped(60, by: -PlaybackScrubber.keyStep, length: 184) == 55)
    }

    @Test func staysWithinTheRecording() {
        #expect(PlaybackScrubber.stepped(2, by: -5, length: 184) == 0)
        #expect(PlaybackScrubber.stepped(182, by: 5, length: 184) == 184)
    }
}

@Suite struct MusicPlayerCardTests {
    @Test func fillsTheCardsHeightWithSquareArtwork() {
        #expect(MusicPlayerCard.artworkSide(height: 175) == 175 - 2 * MusicPlayerCard.inset)
    }

    @Test func dropsTheArtworkWhenTheCardIsTooShortToShowIt() {
        #expect(MusicPlayerCard.artworkSide(height: 60) == nil)
    }
}

private final class QuietTrackCommands: TrackCommands {
    func enable(next: @escaping @MainActor () -> Void, previous: @escaping @MainActor () -> Void) {}
    func disable() {}
}

@MainActor
@Suite final class PlaylistControlsTests {
    private let suite = TemporaryDefaults("PlaylistControlsTests")
    private var defaults: UserDefaults { suite.defaults }

    private func playback(_ player: PlayerModel = PlayerModel()) -> ListPlayback {
        ListPlayback(player: player, commands: QuietTrackCommands(), defaults: defaults)
    }

    @Test func namesTheListAndThePlaceInIt() {
        #expect(
            PlaylistControlText.subtitle(listName: "Session set", position: 2, count: 5) == "Session set \u{B7} 2 of 5")
    }

    @Test func subtitleShowsOnlyWhilePlaying() {
        let player = PlayerModel()
        let playback = playback(player)
        #expect(PlayerBar.playlistSubtitle(playback) == nil)
        playback.start(listID: "l1", name: "Session set", tuneIDs: ["a", "b"], shuffled: false)
        #expect(PlayerBar.playlistSubtitle(playback) == "Session set \u{B7} 1 of 2")
        #expect(PlayerBar.playlistSubtitle(nil) == nil)
        playback.end()
    }

    @Test func namesEachRepeatMode() {
        #expect(PlaylistControlText.repeatLabel(.off) == "Repeat off")
        #expect(PlaylistControlText.repeatLabel(.list) == "Repeat list")
        #expect(PlaylistControlText.repeatLabel(.one) == "Repeat tune")
        #expect(PlaylistControlText.repeatSymbol(.off) == "repeat")
        #expect(PlaylistControlText.repeatSymbol(.list) == "repeat")
        #expect(PlaylistControlText.repeatSymbol(.one) == "repeat.1")
    }

    @Test func offersNextOnlyWhilePlayingAList() {
        let playback = playback()
        #expect(!PlayerBar.showsNext(playback))
        #expect(!PlayerBar.showsNext(nil))
        playback.start(listID: "l1", name: "Session set", tuneIDs: ["a"], shuffled: false)
        #expect(PlayerBar.showsNext(playback))
        playback.end()
        #expect(!PlayerBar.showsNext(playback))
    }

    @Test func labelsTheBarWithTheListWhilePlaying() throws {
        let player = PlayerModel()
        let playback = playback(player)
        player.play(PlayerItem(kind: .recording, id: "r1", title: "Kitchen Girl"))
        #expect(PlayerBar.showLabel(player, playback: playback) == "Show player, Kitchen Girl")
        playback.start(listID: "l1", name: "Session set", tuneIDs: ["a", "b"], shuffled: false)
        #expect(
            PlayerBar.showLabel(player, playback: playback) == "Show player, Kitchen Girl, Session set \u{B7} 1 of 2")
        playback.end()
    }

    @Test func dropsTheMessageWhenSomethingElsePlays() async throws {
        let player = PlayerModel()
        let playback = playback(player)
        playback.start(listID: "l1", name: "Session set", tuneIDs: ["a"], shuffled: false)
        #expect(try await poll { playback.endMessage != nil })
        player.play(PlayerItem(kind: .recording, id: "r1", title: "Kitchen Girl"))
        #expect(playback.endMessage == nil)
        player.close()
        #expect(!PlayerBar.isShown(player, playback))
    }

    @Test func showsTheBarForAMessageWithNothingLoaded() async throws {
        let player = PlayerModel()
        let playback = playback(player)
        #expect(!PlayerBar.isShown(player, playback))
        // Nothing resolves, so the playlist stops with its message.
        playback.start(listID: "l1", name: "Session set", tuneIDs: ["a"], shuffled: false)
        #expect(try await poll { playback.endMessage != nil })
        #expect(!player.isLoaded)
        #expect(PlayerBar.isShown(player, playback))
        PlayerBar.closePlayer(player, playback)
        #expect(!PlayerBar.isShown(player, playback))
    }
}

@Suite struct AccessorySwipeTests {
    @Test func swipeSkipsOnlyPastTheThresholdWhileAListPlays() {
        #expect(AccessorySwipe.skip(translation: -61, isPlayingList: true) == .next)
        #expect(AccessorySwipe.skip(translation: 61, isPlayingList: true) == .previous)
        #expect(AccessorySwipe.skip(translation: -59, isPlayingList: true) == nil)
        #expect(AccessorySwipe.skip(translation: 59, isPlayingList: true) == nil)
        #expect(AccessorySwipe.skip(translation: -200, isPlayingList: false) == nil)
    }

    @Test func swipeSkipsOnlyWhereTheListHasATuneToGoTo() {
        #expect(AccessorySwipe.hasPlace(for: .next, position: 1, count: 3, repeats: false))
        #expect(!AccessorySwipe.hasPlace(for: .next, position: 3, count: 3, repeats: false))
        #expect(AccessorySwipe.hasPlace(for: .next, position: 3, count: 3, repeats: true))
        #expect(AccessorySwipe.hasPlace(for: .previous, position: 2, count: 3, repeats: false))
        #expect(!AccessorySwipe.hasPlace(for: .previous, position: 1, count: 3, repeats: true))
    }
}
