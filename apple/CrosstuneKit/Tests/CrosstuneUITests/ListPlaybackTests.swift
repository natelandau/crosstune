import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// Notes whether next and previous are offered, and presses them as the system would.
@MainActor
private final class FakeTrackCommands: TrackCommands {
    private(set) var isEnabled = false
    private var onNext: (@MainActor () -> Void)?
    private var onPrevious: (@MainActor () -> Void)?

    func enable(next: @escaping @MainActor () -> Void, previous: @escaping @MainActor () -> Void) {
        isEnabled = true
        onNext = next
        onPrevious = previous
    }

    func disable() {
        isEnabled = false
        onNext = nil
        onPrevious = nil
    }

    func pressNext() { onNext?() }
    func pressPrevious() { onPrevious?() }
}

/// Answers each tune from `items`, read when asked so a test can change it mid-play, and holds
/// the tunes in `holding` until the test releases them.
@MainActor
private final class FakeResolver {
    var items: [String: PlayerItem]
    var holding: Set<String> = []
    private var held: [String: CheckedContinuation<Void, Never>] = [:]
    private(set) var asked: [String] = []
    /// The tunes whose answers have come back, in order.
    private(set) var answered: [String] = []

    init(_ items: [String: PlayerItem]) {
        self.items = items
    }

    private(set) var lists: [String] = []

    func resolve(_ listID: String, _ tuneID: String) async -> ListPlayback.Turn? {
        asked.append(tuneID)
        lists.append(listID)
        if holding.contains(tuneID) { await withCheckedContinuation { held[tuneID] = $0 } }
        answered.append(tuneID)
        return items[tuneID].map { ListPlayback.Turn(title: "Tune \(tuneID)", item: $0) }
    }

    func isHolding(_ tuneID: String) -> Bool { held[tuneID] != nil }

    func release(_ tuneID: String) {
        holding.remove(tuneID)
        held.removeValue(forKey: tuneID)?.resume()
    }
}

private let listName = "Session"

private func recording(_ tune: String) -> PlayerItem {
    let row = Recording(
        id: "r\(tune)", tuneID: tune, source: "microphone", addedAt: noon, label: "Take \(tune)", state: "ready")
    return .recording(row, tuneTitle: "Tune \(tune)")
}

private func song(_ tune: String) throws -> PlayerItem {
    let track = ["a": "1440833091", "b": "1440833092", "c": "1440833093"][tune] ?? "1440833099"
    let url = "https://music.apple.com/us/album/the-silver-spear/1440833081?i=\(track)"
    let link = RecordingLink(
        id: "l\(tune)", tuneID: tune, url: url, provider: "apple_music", providerRef: detectProvider(url).providerRef)
    return try #require(PlayerItem.link(link))
}

private func audioFile(_ recordingID: String) -> RecordingAudioFile {
    RecordingAudioFile(
        url: URL(filePath: "/tmp/\(recordingID).m4a"), file: RecordingFile(id: recordingID, localState: .downloaded))
}

private func songKind(_ tune: String) throws -> AppleMusicKind {
    try #require(try song(tune).link?.appleMusic)
}

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("The condition never held")
}

@MainActor
@Suite final class ListPlaybackTests {
    private struct Fixture {
        let player: PlayerModel
        let audio: FakeAudio
        let music: FakeMusic
        let commands: FakeTrackCommands
        let resolver: FakeResolver
        let playback: ListPlayback
    }

    private let suite = TemporaryDefaults("ListPlaybackTests")
    private var defaults: UserDefaults { suite.defaults }

    private func fixture(_ items: [String: PlayerItem]? = nil) -> Fixture {
        let audio = FakeAudio()
        let music = FakeMusic()
        let player = PlayerModel(audio: audio, appleMusic: AppleMusic(access: FakeAccess(.fullTracks), player: music))
        player.audioSource = { audioFile($0) }
        let commands = FakeTrackCommands()
        // A length above zero, so each finish counts as a tune that played.
        audio.duration = 60
        let resolver = FakeResolver(
            items ?? [
                "a": recording("a"), "b": recording("b"), "c": recording("c"), "d": recording("d"), "e": recording("e"),
            ])
        let playback = ListPlayback(player: player, commands: commands, defaults: defaults, rng: SplitMix64(seed: 1))
        playback.resolve = { await resolver.resolve($0, $1) }
        return Fixture(
            player: player, audio: audio, music: music, commands: commands, resolver: resolver, playback: playback)
    }

    private func start(_ fixture: Fixture, _ tuneIDs: [String] = ["a", "b", "c"], at tuneID: String? = nil) {
        fixture.playback.start(listID: "list1", name: listName, tuneIDs: tuneIDs, shuffled: false, at: tuneID)
    }

    private func playing(_ fixture: Fixture, _ itemID: String) async throws {
        try await eventually { fixture.player.item?.id == itemID && fixture.player.transport?.isPlaying == true }
    }

    private func loads(_ fixture: Fixture) -> Int {
        fixture.audio.calls.count(where: { $0 == "load" })
    }

    @Test func practiceScreenHeaderFollowsASkip() async throws {
        let fixture = fixture()
        start(fixture)
        try await playing(fixture, "ra")
        let own = RecordingScreenText.subtitle(
            Recording(id: "ra", tuneID: "a", source: "microphone", addedAt: noon, label: "Take a", state: "ready"),
            tuneTitle: "Tune a", lengthMs: nil)
        func header() -> String? {
            PadPracticeHeader.subtitle(
                recording: Recording(
                    id: "ra", tuneID: "a", source: "microphone", addedAt: noon, label: "Take a", state: "ready"),
                tuneTitle: "Tune a", lengthMs: nil, playback: fixture.playback, showsReadingPane: true)
        }
        #expect(header() == "\(listName) \u{B7} 1 of 3")
        #expect(header() != own)

        fixture.playback.next()
        try await playing(fixture, "rb")
        #expect(header() == "\(listName) \u{B7} 2 of 3")
    }

    @Test func playsInOrderAndAdvancesOnFinish() async throws {
        let fixture = fixture()
        start(fixture)
        try await playing(fixture, "ra")
        #expect(fixture.playback.isActive)
        #expect(fixture.playback.listID == "list1")
        #expect(fixture.playback.listName == listName)
        #expect(fixture.playback.currentTuneID == "a")
        #expect(fixture.playback.position == 1)
        #expect(fixture.playback.count == 3)
        #expect(fixture.commands.isEnabled)
        #expect(fixture.player.queue === fixture.playback)
        #expect(fixture.audio.nowPlaying == NowPlaying(title: "Tune a", tuneTitle: listName))

        fixture.audio.end(.finished)
        try await playing(fixture, "rb")
        #expect(fixture.playback.position == 2)
        fixture.audio.end(.finished)
        try await playing(fixture, "rc")
        #expect(fixture.playback.position == 3)

        // With repeat off the playlist ends on the last tune, paused.
        fixture.audio.end(.finished)
        try await eventually { !fixture.playback.isActive }
        #expect(fixture.player.item?.id == "rc")
        #expect(fixture.player.queue == nil)
        #expect(!fixture.audio.isPlaying)
        #expect(!fixture.commands.isEnabled)
        #expect(fixture.playback.endMessage == nil)
        #expect(fixture.resolver.asked == ["a", "b", "c"])
    }

    @Test func startingFromAReportStopsWhatWasLoadedAtOnce() async throws {
        let fixture = fixture()
        fixture.player.play(recording("x"))
        try await playing(fixture, "rx")
        fixture.resolver.holding = ["a"]
        let report = PlaylistReport(playable: ["a", "b"], skipped: [:], total: 2)
        fixture.playback.start(listID: "list1", name: listName, report: report, shuffled: false)
        // The first tune is still resolving, and what was loaded is already gone.
        try await eventually { fixture.resolver.isHolding("a") }
        #expect(fixture.player.item == nil)
        fixture.resolver.release("a")
        try await playing(fixture, "ra")
    }

    @Test func startDropsARepeatedTune() async throws {
        let fixture = fixture()
        start(fixture, ["a", "b", "a"])
        try await playing(fixture, "ra")
        #expect(fixture.playback.count == 2)
    }

    @Test func skipsAnUnresolvableTune() async throws {
        let fixture = fixture(["a": recording("a"), "c": recording("c")])
        start(fixture)
        try await playing(fixture, "ra")
        fixture.audio.end(.finished)
        try await playing(fixture, "rc")
        #expect(fixture.resolver.asked == ["a", "b", "c"])
        #expect(fixture.playback.position == 3)
    }

    @Test func skipsWhenThePlayerCouldNotPlay() async throws {
        let fixture = fixture()
        fixture.player.audioSource = { id in
            guard id != "rb" else { return nil }
            return audioFile(id)
        }
        start(fixture)
        try await playing(fixture, "ra")
        fixture.audio.end(.finished)
        try await playing(fixture, "rc")
        #expect(fixture.resolver.asked == ["a", "b", "c"])
    }

    @Test func stopsAfterOneFailedPassWithRepeatList() async throws {
        let fixture = fixture([:])
        fixture.playback.cycleRepeat()
        #expect(fixture.playback.repeatMode == .list)
        start(fixture, at: "b")
        try await eventually { !fixture.playback.isActive }
        #expect(fixture.playback.endMessage == ListPlaybackText.nothingLeft)
        #expect(fixture.resolver.asked == ["b", "c", "a"])
        #expect(!fixture.player.isLoaded)
        #expect(fixture.player.queue == nil)
        #expect(!fixture.commands.isEnabled)
    }

    @Test func failingTunesAfterOneThatPlayedStopWithTheMessage() async throws {
        let fixture = fixture()
        fixture.playback.cycleRepeat()
        start(fixture)
        try await playing(fixture, "ra")
        fixture.resolver.items = [:]
        fixture.audio.end(.finished)
        try await eventually { !fixture.playback.isActive }
        #expect(fixture.playback.endMessage == ListPlaybackText.nothingLeft)
        #expect(fixture.resolver.asked == ["a", "b", "c", "a"])
        #expect(!fixture.player.isLoaded)
    }

    @Test func aStaleResolveNeverPlays() async throws {
        let fixture = fixture()
        fixture.resolver.holding = ["a"]
        start(fixture)
        try await eventually { fixture.resolver.isHolding("a") }
        fixture.playback.next()
        try await playing(fixture, "rb")
        fixture.resolver.release("a")
        try await eventually { fixture.resolver.answered.contains("a") }
        #expect(fixture.player.item?.id == "rb")
        #expect(loads(fixture) == 1)
        #expect(fixture.playback.currentTuneID == "b")
        #expect(fixture.playback.position == 2)
    }

    @Test func previousRestartsAfterThreeSeconds() async throws {
        let fixture = fixture()
        start(fixture, at: "b")
        try await playing(fixture, "rb")
        fixture.audio.elapsed = 5
        fixture.commands.pressPrevious()
        #expect(fixture.audio.elapsed == 0)
        #expect(fixture.audio.calls.last == "seek")
        #expect(fixture.player.item?.id == "rb")
        #expect(fixture.playback.position == 2)
        #expect(fixture.resolver.asked == ["b"])
    }

    @Test func previousGoesBackWithinThreeSeconds() async throws {
        let fixture = fixture()
        start(fixture, at: "b")
        try await playing(fixture, "rb")
        fixture.audio.elapsed = 2
        fixture.commands.pressPrevious()
        try await playing(fixture, "ra")
        #expect(fixture.playback.position == 1)

        // At the first tune it restarts.
        fixture.playback.previous()
        #expect(fixture.audio.calls.last == "seek")
        #expect(fixture.player.item?.id == "ra")
        #expect(fixture.resolver.asked == ["b", "a"])
    }

    @Test func repeatOneReplaysTheTune() async throws {
        let fixture = fixture()
        fixture.playback.cycleRepeat()
        fixture.playback.cycleRepeat()
        #expect(fixture.playback.repeatMode == .one)
        start(fixture)
        try await playing(fixture, "ra")
        fixture.audio.end(.finished)
        try await eventually { self.loads(fixture) == 2 && fixture.audio.isPlaying }
        #expect(fixture.player.item?.id == "ra")
        #expect(fixture.playback.position == 1)

        // A skip still moves on.
        fixture.commands.pressNext()
        try await playing(fixture, "rb")
    }

    @Test func musicKitNextGoesToTheNextTune() async throws {
        let fixture = fixture(["a": try song("a"), "b": try song("b")])
        start(fixture, ["a", "b"])
        try await playing(fixture, "la")
        fixture.music.end(.next)
        try await playing(fixture, "lb")
        #expect(fixture.music.loaded == [try songKind("a"), try songKind("b")])
        #expect(fixture.music.guardedLoads == [true, true])
    }

    @Test func musicKitPreviousPastThreeSecondsReplaysTheSong() async throws {
        let fixture = fixture(["a": try song("a"), "b": try song("b")])
        start(fixture, ["a", "b"], at: "b")
        try await playing(fixture, "lb")
        fixture.music.end(.previous(elapsed: 5))
        try await eventually { fixture.music.loaded.count == 2 && fixture.music.isPlaying }
        #expect(fixture.music.loaded == [try songKind("b"), try songKind("b")])
        #expect(fixture.player.item?.id == "lb")
        #expect(fixture.playback.position == 2)
    }

    @Test func musicKitPreviousWithinThreeSecondsGoesBack() async throws {
        let fixture = fixture(["a": try song("a"), "b": try song("b")])
        start(fixture, ["a", "b"], at: "b")
        try await playing(fixture, "lb")
        fixture.music.end(.previous(elapsed: 2))
        try await playing(fixture, "la")
        #expect(fixture.playback.position == 1)

        // At the first tune it replays.
        fixture.music.end(.previous(elapsed: 1))
        try await eventually { fixture.music.loaded.count == 3 && fixture.music.isPlaying }
        #expect(fixture.music.loaded.last == (try songKind("a")))
        #expect(fixture.playback.position == 1)
    }

    @Test func musicKitPreviousWaitsForMusicKitToSettle() async throws {
        let fixture = fixture(["a": try song("a"), "b": try song("b"), "c": try song("c")])
        fixture.music.holdsSettles = true
        start(fixture, at: "b")
        try await playing(fixture, "lb")
        fixture.music.end(.previous(elapsed: 1))
        try await eventually { fixture.music.isHoldingSettle }
        #expect(fixture.music.loaded.count == 1)
        #expect(fixture.resolver.asked == ["b"])
        fixture.music.releaseSettle()
        try await playing(fixture, "la")

        // A next while it waits wins over the previous.
        fixture.music.end(.previous(elapsed: 1))
        try await eventually { fixture.music.isHoldingSettle }
        fixture.playback.next()
        try await playing(fixture, "lb")
        fixture.music.releaseSettle()
        try await eventually { fixture.music.settled == 2 }
        #expect(fixture.player.item?.id == "lb")
        #expect(fixture.playback.position == 2)
        #expect(fixture.resolver.asked == ["b", "a", "b"])
    }

    @Test func jumpToAnUnplayableTuneReturnsFalse() async throws {
        let fixture = fixture(["a": recording("a"), "c": recording("c")])
        start(fixture)
        try await playing(fixture, "ra")
        #expect(await fixture.playback.jump(to: "b") == false)
        #expect(fixture.player.item?.id == "ra")
        #expect(fixture.playback.position == 1)

        // The tune still playing carries on through the playlist.
        fixture.audio.end(.finished)
        try await playing(fixture, "rc")

        #expect(await fixture.playback.jump(to: "a"))
        try await playing(fixture, "ra")
        #expect(fixture.playback.position == 1)
        #expect(fixture.playback.currentTuneID == "a")
    }

    @Test func aDeletedTuneIsSkippedWhenItsTurnComes() async throws {
        let fixture = fixture()
        start(fixture)
        try await playing(fixture, "ra")
        fixture.resolver.items["b"] = nil
        fixture.audio.end(.finished)
        try await playing(fixture, "rc")
        #expect(fixture.playback.position == 3)
    }

    @Test func aPinChangedMidPlayAppliesFromTheNextTune() async throws {
        let fixture = fixture(["a": recording("a"), "b": recording("b")])
        start(fixture, ["a", "b"])
        try await playing(fixture, "ra")
        fixture.resolver.items = ["a": try song("a"), "b": try song("b")]
        #expect(fixture.player.item?.id == "ra")
        #expect(loads(fixture) == 1)
        fixture.audio.end(.finished)
        try await playing(fixture, "lb")
        #expect(fixture.music.loaded == [try songKind("b")])
    }

    @Test func closeEndsThePlaylistAndDisablesCommands() async throws {
        let fixture = fixture()
        start(fixture)
        try await playing(fixture, "ra")
        fixture.player.close()
        #expect(!fixture.playback.isActive)
        #expect(fixture.playback.listID == nil)
        #expect(fixture.playback.currentTuneID == nil)
        #expect(fixture.playback.count == 0)
        #expect(fixture.playback.endMessage == nil)
        #expect(!fixture.commands.isEnabled)
        #expect(!fixture.player.isLoaded)
    }

    @Test func endLeavesTheLoadedTune() async throws {
        let fixture = fixture()
        start(fixture)
        try await playing(fixture, "ra")
        fixture.playback.end()
        #expect(!fixture.playback.isActive)
        #expect(!fixture.commands.isEnabled)
        #expect(fixture.player.queue == nil)
        #expect(fixture.player.item?.id == "ra")
        // The tune's end no longer reaches the playlist.
        let asked = fixture.resolver.asked
        fixture.audio.end(.finished)
        fixture.music.end(.next)
        #expect(fixture.resolver.asked == asked)
        #expect(fixture.player.item?.id == "ra")
        #expect(loads(fixture) == 1)
    }

    @Test func repeatAndShuffleSurviveARestart() {
        let fixture = fixture()
        fixture.playback.cycleRepeat()
        fixture.playback.setShuffled(true)
        #expect(defaults.string(forKey: "listPlayback.repeat") == "list")
        #expect(defaults.bool(forKey: "listPlayback.shuffle"))

        let again = ListPlayback(player: fixture.player, commands: FakeTrackCommands(), defaults: defaults)
        #expect(again.repeatMode == .list)
        #expect(again.isShuffled)
        again.cycleRepeat()
        again.cycleRepeat()
        #expect(again.repeatMode == .off)
        #expect(
            ListPlayback(player: fixture.player, commands: FakeTrackCommands(), defaults: defaults).repeatMode == .off)
    }

    @Test func resolvesEachTuneWithinThePlayingList() async throws {
        let fixture = fixture()
        start(fixture)
        try await playing(fixture, "ra")
        #expect(fixture.resolver.lists == ["list1"])
    }

    @Test func startFromAReportPlaysOnlyTheTunesThatWillPlay() async throws {
        let fixture = fixture()
        let report = PlaylistReport(playable: ["a", "c"], skipped: [.nothing: ["b"]], total: 3)
        fixture.playback.start(listID: "list1", name: listName, report: report, shuffled: false)
        try await playing(fixture, "ra")
        #expect(fixture.playback.count == 2)
        fixture.audio.end(.finished)
        try await playing(fixture, "rc")
        #expect(fixture.playback.position == 2)
        #expect(fixture.resolver.asked == ["a", "c"])
    }

    @Test func theBarAndNowPlayingNameTheTuneNotItsSource() async throws {
        let fixture = fixture(["a": recording("a"), "b": try song("b")])
        start(fixture, ["a", "b"])
        try await playing(fixture, "ra")
        #expect(fixture.player.title != "Tune a")
        #expect(fixture.playback.title == "Tune a")
        #expect(PlayerBar.title(fixture.player, fixture.playback) == "Tune a")
        #expect(PlayerBar.showLabel(fixture.player, playback: fixture.playback).contains("Tune a"))
        fixture.audio.end(.finished)
        try await playing(fixture, "lb")
        #expect(PlayerBar.title(fixture.player, fixture.playback) == "Tune b")

        // Played on its own, the bar names what the player holds.
        fixture.playback.end()
        #expect(PlayerBar.title(fixture.player, fixture.playback) == fixture.player.title)
    }

    @Test func theBarTitleAndPositionChangeTogetherWhenTheNextTuneLoads() async throws {
        let fixture = fixture()
        start(fixture, ["a", "b"])
        try await playing(fixture, "ra")
        fixture.resolver.holding = ["b"]
        fixture.playback.next()
        try await eventually { fixture.resolver.isHolding("b") }
        #expect(fixture.playback.currentTuneID == "b")
        #expect(PlayerBar.title(fixture.player, fixture.playback) == "Tune a")
        #expect(fixture.playback.position == 1)
        fixture.resolver.release("b")
        try await playing(fixture, "rb")
        #expect(PlayerBar.title(fixture.player, fixture.playback) == "Tune b")
        #expect(fixture.playback.position == 2)
    }

    @Test func aSecondNextAtTheEndPausesTheTuneStillPlaying() async throws {
        let fixture = fixture()
        start(fixture, ["a", "b"])
        try await playing(fixture, "ra")
        fixture.resolver.holding = ["b"]
        fixture.playback.next()
        try await eventually { fixture.resolver.isHolding("b") }
        fixture.playback.next()
        #expect(!fixture.playback.isActive)
        #expect(!fixture.audio.isPlaying)
        fixture.resolver.release("b")
        try await eventually { fixture.resolver.answered.contains("b") }
        #expect(fixture.player.item?.id == "ra")
    }

    @Test func aZeroLengthTrackDoesNotCountAsPlayed() async throws {
        let fixture = fixture(["a": recording("a")])
        fixture.audio.duration = 0
        fixture.playback.cycleRepeat()
        start(fixture)
        try await playing(fixture, "ra")
        fixture.audio.end(.finished)
        try await eventually { self.loads(fixture) == 2 && fixture.audio.isPlaying }
        fixture.audio.end(.finished)
        try await eventually { !fixture.playback.isActive }
        #expect(fixture.playback.endMessage == ListPlaybackText.nothingLeft)
    }

    @Test func aTrackThatPlayedLetsRepeatGoRound() async throws {
        let fixture = fixture(["a": recording("a")])
        fixture.playback.cycleRepeat()
        start(fixture)
        try await playing(fixture, "ra")
        for round in 2...3 {
            fixture.audio.end(.finished)
            try await eventually { self.loads(fixture) == round && fixture.audio.isPlaying }
        }
        #expect(fixture.playback.isActive)
    }

    @Test func settlesOnceTheNewTuneLoads() async throws {
        let fixture = fixture()
        start(fixture)
        try await playing(fixture, "ra")
        #expect(fixture.playback.isSettled)
        fixture.resolver.holding = ["b"]
        fixture.playback.next()
        #expect(!fixture.playback.isSettled)
        try await eventually { fixture.resolver.isHolding("b") }
        fixture.resolver.release("b")
        try await playing(fixture, "rb")
        #expect(fixture.playback.isSettled)
    }

    @Test func shuffleOnDuringPlayShufflesOnlyTheTunesAhead() async throws {
        let fixture = fixture()
        start(fixture, ["a", "b", "c", "d", "e"], at: "b")
        try await playing(fixture, "rb")
        fixture.playback.setShuffled(true)
        #expect(fixture.playback.isShuffled)
        #expect(fixture.playback.position == 2)
        #expect(fixture.playback.currentTuneID == "b")
        #expect(self.loads(fixture) == 1)
        var played: [String] = []
        for position in 3...5 {
            fixture.playback.next()
            try await eventually {
                fixture.playback.position == position && fixture.audio.isPlaying && self.loads(fixture) == position - 1
            }
            played.append(try #require(fixture.playback.currentTuneID))
        }
        #expect(played.sorted() == ["c", "d", "e"])
    }

    @Test func shuffleOffDuringPlayGoesOnInListOrder() async throws {
        let fixture = fixture()
        fixture.playback.start(
            listID: "list1", name: listName, tuneIDs: ["a", "b", "c", "d", "e"], shuffled: true, at: "c")
        try await playing(fixture, "rc")
        fixture.playback.setShuffled(false)
        #expect(!fixture.playback.isShuffled)
        #expect(fixture.playback.position == 3)
        #expect(self.loads(fixture) == 1)
        fixture.playback.next()
        try await playing(fixture, "rd")
        fixture.playback.next()
        try await playing(fixture, "re")
    }

    @Test func aJumpWhileTheNextTuneResolvesWins() async throws {
        let fixture = fixture()
        start(fixture)
        try await playing(fixture, "ra")
        fixture.resolver.holding = ["b"]
        fixture.playback.next()
        try await eventually { fixture.resolver.isHolding("b") }
        #expect(await fixture.playback.jump(to: "c"))
        try await playing(fixture, "rc")
        fixture.resolver.release("b")
        try await eventually { fixture.resolver.answered.contains("b") }
        #expect(fixture.player.item?.id == "rc")
        #expect(fixture.playback.currentTuneID == "c")
        #expect(fixture.playback.position == 3)
    }

    @Test func aSecondStartReplacesTheFirstWhileItResolves() async throws {
        let fixture = fixture()
        fixture.resolver.holding = ["a"]
        start(fixture)
        try await eventually { fixture.resolver.isHolding("a") }
        fixture.playback.start(listID: "list2", name: "Other", tuneIDs: ["c"], shuffled: false)
        try await playing(fixture, "rc")
        fixture.resolver.release("a")
        try await eventually { fixture.resolver.answered.contains("a") }
        #expect(fixture.player.item?.id == "rc")
        #expect(fixture.playback.listID == "list2")
        #expect(fixture.playback.count == 1)
        #expect(self.loads(fixture) == 1)
    }
}

/// A list played through reports its start once, and each track as it ends with how it was
/// reached.
@MainActor
@Suite struct PlaylistEventTests {
    private let suite = TemporaryDefaults("PlaylistEventTests")
    private let commands = FakeTrackCommands()

    private func playlist(_ fixture: ActivityFixture) -> ListPlayback {
        let playback = ListPlayback(
            player: fixture.player, commands: commands, defaults: suite.defaults, analytics: fixture.sink.client)
        playback.resolve = { _, tuneID in
            ListPlayback.Turn(
                title: "Tune \(tuneID)", item: .recording(loggedRecording("r\(tuneID)", tuneID: tuneID), tuneTitle: nil)
            )
        }
        return playback
    }

    /// Waits until recording `id` plays and the play log has heard it.
    private func playing(_ fixture: ActivityFixture, _ id: String) async throws {
        try await waitFor { fixture.audio.isPlaying && fixture.player.item?.id == id }
        try await fixture.fed { $0.loaded == PlaySubject(kind: .recording, id: id) && $0.playing }
    }

    @Test func playingAListReportsThePlaylistOnceAndEachTrack() async throws {
        let fixture = ActivityFixture()
        let playback = playlist(fixture)
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b", "c"], shuffled: false)
        try await playing(fixture, "ra")
        fixture.clock.advance(15_000)
        fixture.audio.end(.finished)
        try await playing(fixture, "rb")
        fixture.clock.advance(15_000)
        fixture.audio.end(.finished)
        try await waitFor { fixture.sent("playback_ended").count == 2 }
        #expect(
            fixture.sent("playlist_started") == [
                [
                    "shuffle": .bool(false), "repeat": .string("off"), "count_bucket": .string("1-9"),
                    "list_id": .string("list1"),
                ]
            ])
        let ended = fixture.sent("playback_ended")
        #expect(ended.map { $0["queue"] } == [.string("playlist"), .string("playlist")])
        #expect(ended.map { $0["source"] } == [.string("list"), .string("list")])
        #expect(ended.map { $0["trigger"] } == [.string("tap"), .string("auto_advance")])
        #expect(ended.map { $0["ended_by"] } == [.string("finished"), .string("finished")])
        #expect(ended.map { $0["list_id"] } == [.string("list1"), .string("list1")])
        playback.end()
    }

    @Test func aPlaylistReportsItsStartOnceItsFirstTuneLoads() async throws {
        let fixture = ActivityFixture()
        let playback = playlist(fixture)
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b"], shuffled: false)
        #expect(fixture.sent("playlist_started").isEmpty)
        try await playing(fixture, "ra")
        #expect(fixture.sent("playlist_started").count == 1)
        playback.end()
    }

    @Test func aPlaylistWithNothingToPlayReportsNoStart() async throws {
        let fixture = ActivityFixture()
        let playback = playlist(fixture)
        playback.resolve = { _, _ in nil }
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b"], shuffled: false)
        try await waitFor { playback.endMessage == ListPlaybackText.nothingLeft }
        #expect(fixture.sent("playlist_started").isEmpty)
    }

    @Test func aPlaylistRefusedDuringARecordingReportsNoStart() async throws {
        let fixture = ActivityFixture()
        fixture.player.isCapturing = { true }
        let playback = playlist(fixture)
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b"], shuffled: false)
        try await waitFor { !playback.isActive }
        #expect(fixture.sent("playlist_started").isEmpty)
    }

    @Test func nextInAPlaylistIsASkip() async throws {
        let fixture = ActivityFixture()
        let playback = playlist(fixture)
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b", "c"], shuffled: false)
        try await playing(fixture, "ra")
        fixture.clock.advance(5_000)
        commands.pressNext()
        try await playing(fixture, "rb")
        fixture.clock.advance(12_000)
        playback.end()
        fixture.player.close()
        try await waitFor { fixture.sent("playback_ended").count == 2 }
        let ended = fixture.sent("playback_ended")
        #expect(ended.map { $0["recording_id"] } == [.string("ra"), .string("rb")])
        #expect(ended.first?["ended_by"] == .string("skipped"))
        #expect(ended.last?["trigger"] == .string("skip"))
        #expect(fixture.sent("playlist_started").count == 1)
    }
}
