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
    private struct Rig {
        let player: PlayerModel
        let audio: FakeAudio
        let music: FakeMusic
        let commands: FakeTrackCommands
        let resolver: FakeResolver
        let playback: ListPlayback
    }

    private let suite = TemporaryDefaults("ListPlaybackTests")
    private var defaults: UserDefaults { suite.defaults }

    private func rig(_ items: [String: PlayerItem]? = nil) -> Rig {
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
        return Rig(
            player: player, audio: audio, music: music, commands: commands, resolver: resolver, playback: playback)
    }

    private func start(_ rig: Rig, _ tuneIDs: [String] = ["a", "b", "c"], at tuneID: String? = nil) {
        rig.playback.start(listID: "list1", name: listName, tuneIDs: tuneIDs, shuffled: false, at: tuneID)
    }

    private func playing(_ rig: Rig, _ itemID: String) async throws {
        try await eventually { rig.player.item?.id == itemID && rig.player.transport?.isPlaying == true }
    }

    private func loads(_ rig: Rig) -> Int {
        rig.audio.calls.filter { $0 == "load" }.count
    }

    @Test func standHeaderFollowsASkip() async throws {
        let rig = rig()
        start(rig)
        try await playing(rig, "ra")
        let own = RecordingScreenText.subtitle(
            Recording(id: "ra", tuneID: "a", source: "microphone", addedAt: noon, label: "Take a", state: "ready"),
            tuneTitle: "Tune a", lengthMs: nil)
        func header() -> String? {
            StandHeader.subtitle(
                recording: Recording(
                    id: "ra", tuneID: "a", source: "microphone", addedAt: noon, label: "Take a", state: "ready"),
                tuneTitle: "Tune a", lengthMs: nil, playback: rig.playback, standsWithReading: true)
        }
        #expect(header() == "\(listName) \u{B7} 1 of 3")
        #expect(header() != own)

        rig.playback.next()
        try await playing(rig, "rb")
        #expect(header() == "\(listName) \u{B7} 2 of 3")
    }

    @Test func playsInOrderAndAdvancesOnFinish() async throws {
        let rig = rig()
        start(rig)
        try await playing(rig, "ra")
        #expect(rig.playback.isActive)
        #expect(rig.playback.listID == "list1")
        #expect(rig.playback.listName == listName)
        #expect(rig.playback.currentTuneID == "a")
        #expect(rig.playback.position == 1)
        #expect(rig.playback.count == 3)
        #expect(rig.commands.isEnabled)
        #expect(rig.player.queue === rig.playback)
        #expect(rig.audio.nowPlaying == NowPlaying(title: "Tune a", tuneTitle: listName))

        rig.audio.end(.finished)
        try await playing(rig, "rb")
        #expect(rig.playback.position == 2)
        rig.audio.end(.finished)
        try await playing(rig, "rc")
        #expect(rig.playback.position == 3)

        // With repeat off the playlist ends on the last tune, paused.
        rig.audio.end(.finished)
        try await eventually { !rig.playback.isActive }
        #expect(rig.player.item?.id == "rc")
        #expect(rig.player.queue == nil)
        #expect(!rig.audio.isPlaying)
        #expect(!rig.commands.isEnabled)
        #expect(rig.playback.endMessage == nil)
        #expect(rig.resolver.asked == ["a", "b", "c"])
    }

    @Test func startDropsARepeatedTune() async throws {
        let rig = rig()
        start(rig, ["a", "b", "a"])
        try await playing(rig, "ra")
        #expect(rig.playback.count == 2)
    }

    @Test func skipsAnUnresolvableTune() async throws {
        let rig = rig(["a": recording("a"), "c": recording("c")])
        start(rig)
        try await playing(rig, "ra")
        rig.audio.end(.finished)
        try await playing(rig, "rc")
        #expect(rig.resolver.asked == ["a", "b", "c"])
        #expect(rig.playback.position == 3)
    }

    @Test func skipsWhenThePlayerCouldNotPlay() async throws {
        let rig = rig()
        rig.player.audioSource = { id in
            guard id != "rb" else { return nil }
            return audioFile(id)
        }
        start(rig)
        try await playing(rig, "ra")
        rig.audio.end(.finished)
        try await playing(rig, "rc")
        #expect(rig.resolver.asked == ["a", "b", "c"])
    }

    @Test func stopsAfterOneFailedPassWithRepeatList() async throws {
        let rig = rig([:])
        rig.playback.cycleRepeat()
        #expect(rig.playback.repeatMode == .list)
        start(rig, at: "b")
        try await eventually { !rig.playback.isActive }
        #expect(rig.playback.endMessage == ListPlaybackText.nothingLeft)
        #expect(rig.resolver.asked == ["b", "c", "a"])
        #expect(!rig.player.isLoaded)
        #expect(rig.player.queue == nil)
        #expect(!rig.commands.isEnabled)
    }

    @Test func failingTunesAfterOneThatPlayedStopWithTheMessage() async throws {
        let rig = rig()
        rig.playback.cycleRepeat()
        start(rig)
        try await playing(rig, "ra")
        rig.resolver.items = [:]
        rig.audio.end(.finished)
        try await eventually { !rig.playback.isActive }
        #expect(rig.playback.endMessage == ListPlaybackText.nothingLeft)
        #expect(rig.resolver.asked == ["a", "b", "c", "a"])
        #expect(!rig.player.isLoaded)
    }

    @Test func aStaleResolveNeverPlays() async throws {
        let rig = rig()
        rig.resolver.holding = ["a"]
        start(rig)
        try await eventually { rig.resolver.isHolding("a") }
        rig.playback.next()
        try await playing(rig, "rb")
        rig.resolver.release("a")
        try await eventually { rig.resolver.answered.contains("a") }
        #expect(rig.player.item?.id == "rb")
        #expect(loads(rig) == 1)
        #expect(rig.playback.currentTuneID == "b")
        #expect(rig.playback.position == 2)
    }

    @Test func previousRestartsAfterThreeSeconds() async throws {
        let rig = rig()
        start(rig, at: "b")
        try await playing(rig, "rb")
        rig.audio.elapsed = 5
        rig.commands.pressPrevious()
        #expect(rig.audio.elapsed == 0)
        #expect(rig.audio.calls.last == "seek")
        #expect(rig.player.item?.id == "rb")
        #expect(rig.playback.position == 2)
        #expect(rig.resolver.asked == ["b"])
    }

    @Test func previousGoesBackWithinThreeSeconds() async throws {
        let rig = rig()
        start(rig, at: "b")
        try await playing(rig, "rb")
        rig.audio.elapsed = 2
        rig.commands.pressPrevious()
        try await playing(rig, "ra")
        #expect(rig.playback.position == 1)

        // At the first tune it restarts.
        rig.playback.previous()
        #expect(rig.audio.calls.last == "seek")
        #expect(rig.player.item?.id == "ra")
        #expect(rig.resolver.asked == ["b", "a"])
    }

    @Test func repeatOneReplaysTheTune() async throws {
        let rig = rig()
        rig.playback.cycleRepeat()
        rig.playback.cycleRepeat()
        #expect(rig.playback.repeatMode == .one)
        start(rig)
        try await playing(rig, "ra")
        rig.audio.end(.finished)
        try await eventually { self.loads(rig) == 2 && rig.audio.isPlaying }
        #expect(rig.player.item?.id == "ra")
        #expect(rig.playback.position == 1)

        // A skip still moves on.
        rig.commands.pressNext()
        try await playing(rig, "rb")
    }

    @Test func musicKitNextGoesToTheNextTune() async throws {
        let rig = rig(["a": try song("a"), "b": try song("b")])
        start(rig, ["a", "b"])
        try await playing(rig, "la")
        rig.music.end(.next)
        try await playing(rig, "lb")
        #expect(rig.music.loaded == [try songKind("a"), try songKind("b")])
        #expect(rig.music.guardedLoads == [true, true])
    }

    @Test func musicKitPreviousPastThreeSecondsReplaysTheSong() async throws {
        let rig = rig(["a": try song("a"), "b": try song("b")])
        start(rig, ["a", "b"], at: "b")
        try await playing(rig, "lb")
        rig.music.end(.previous(elapsed: 5))
        try await eventually { rig.music.loaded.count == 2 && rig.music.isPlaying }
        #expect(rig.music.loaded == [try songKind("b"), try songKind("b")])
        #expect(rig.player.item?.id == "lb")
        #expect(rig.playback.position == 2)
    }

    @Test func musicKitPreviousWithinThreeSecondsGoesBack() async throws {
        let rig = rig(["a": try song("a"), "b": try song("b")])
        start(rig, ["a", "b"], at: "b")
        try await playing(rig, "lb")
        rig.music.end(.previous(elapsed: 2))
        try await playing(rig, "la")
        #expect(rig.playback.position == 1)

        // At the first tune it replays.
        rig.music.end(.previous(elapsed: 1))
        try await eventually { rig.music.loaded.count == 3 && rig.music.isPlaying }
        #expect(rig.music.loaded.last == (try songKind("a")))
        #expect(rig.playback.position == 1)
    }

    @Test func musicKitPreviousWaitsForMusicKitToSettle() async throws {
        let rig = rig(["a": try song("a"), "b": try song("b"), "c": try song("c")])
        rig.music.holdsSettles = true
        start(rig, at: "b")
        try await playing(rig, "lb")
        rig.music.end(.previous(elapsed: 1))
        try await eventually { rig.music.isHoldingSettle }
        #expect(rig.music.loaded.count == 1)
        #expect(rig.resolver.asked == ["b"])
        rig.music.releaseSettle()
        try await playing(rig, "la")

        // A next while it waits wins over the previous.
        rig.music.end(.previous(elapsed: 1))
        try await eventually { rig.music.isHoldingSettle }
        rig.playback.next()
        try await playing(rig, "lb")
        rig.music.releaseSettle()
        try await eventually { rig.music.settled == 2 }
        #expect(rig.player.item?.id == "lb")
        #expect(rig.playback.position == 2)
        #expect(rig.resolver.asked == ["b", "a", "b"])
    }

    @Test func jumpToAnUnplayableTuneReturnsFalse() async throws {
        let rig = rig(["a": recording("a"), "c": recording("c")])
        start(rig)
        try await playing(rig, "ra")
        #expect(await rig.playback.jump(to: "b") == false)
        #expect(rig.player.item?.id == "ra")
        #expect(rig.playback.position == 1)

        // The tune still playing carries on through the playlist.
        rig.audio.end(.finished)
        try await playing(rig, "rc")

        #expect(await rig.playback.jump(to: "a"))
        try await playing(rig, "ra")
        #expect(rig.playback.position == 1)
        #expect(rig.playback.currentTuneID == "a")
    }

    @Test func aDeletedTuneIsSkippedWhenItsTurnComes() async throws {
        let rig = rig()
        start(rig)
        try await playing(rig, "ra")
        rig.resolver.items["b"] = nil
        rig.audio.end(.finished)
        try await playing(rig, "rc")
        #expect(rig.playback.position == 3)
    }

    @Test func aPinChangedMidPlayAppliesFromTheNextTune() async throws {
        let rig = rig(["a": recording("a"), "b": recording("b")])
        start(rig, ["a", "b"])
        try await playing(rig, "ra")
        rig.resolver.items = ["a": try song("a"), "b": try song("b")]
        #expect(rig.player.item?.id == "ra")
        #expect(loads(rig) == 1)
        rig.audio.end(.finished)
        try await playing(rig, "lb")
        #expect(rig.music.loaded == [try songKind("b")])
    }

    @Test func closeEndsThePlaylistAndDisablesCommands() async throws {
        let rig = rig()
        start(rig)
        try await playing(rig, "ra")
        rig.player.close()
        #expect(!rig.playback.isActive)
        #expect(rig.playback.listID == nil)
        #expect(rig.playback.currentTuneID == nil)
        #expect(rig.playback.count == 0)
        #expect(rig.playback.endMessage == nil)
        #expect(!rig.commands.isEnabled)
        #expect(!rig.player.isLoaded)
    }

    @Test func endLeavesTheLoadedTune() async throws {
        let rig = rig()
        start(rig)
        try await playing(rig, "ra")
        rig.playback.end()
        #expect(!rig.playback.isActive)
        #expect(!rig.commands.isEnabled)
        #expect(rig.player.queue == nil)
        #expect(rig.player.item?.id == "ra")
        // The tune's end no longer reaches the playlist.
        let asked = rig.resolver.asked
        rig.audio.end(.finished)
        rig.music.end(.next)
        #expect(rig.resolver.asked == asked)
        #expect(rig.player.item?.id == "ra")
        #expect(loads(rig) == 1)
    }

    @Test func repeatAndShuffleSurviveARestart() {
        let rig = rig()
        rig.playback.cycleRepeat()
        rig.playback.setShuffled(true)
        #expect(defaults.string(forKey: "listPlayback.repeat") == "list")
        #expect(defaults.bool(forKey: "listPlayback.shuffle"))

        let again = ListPlayback(player: rig.player, commands: FakeTrackCommands(), defaults: defaults)
        #expect(again.repeatMode == .list)
        #expect(again.isShuffled)
        again.cycleRepeat()
        again.cycleRepeat()
        #expect(again.repeatMode == .off)
        #expect(ListPlayback(player: rig.player, commands: FakeTrackCommands(), defaults: defaults).repeatMode == .off)
    }

    @Test func resolvesEachTuneWithinThePlayingList() async throws {
        let rig = rig()
        start(rig)
        try await playing(rig, "ra")
        #expect(rig.resolver.lists == ["list1"])
    }

    @Test func startFromAReportPlaysOnlyTheTunesThatWillPlay() async throws {
        let rig = rig()
        let report = PlaylistReport(playable: ["a", "c"], skipped: [.nothing: ["b"]], total: 3)
        rig.playback.start(listID: "list1", name: listName, report: report, shuffled: false)
        try await playing(rig, "ra")
        #expect(rig.playback.count == 2)
        rig.audio.end(.finished)
        try await playing(rig, "rc")
        #expect(rig.playback.position == 2)
        #expect(rig.resolver.asked == ["a", "c"])
    }

    @Test func theBarAndNowPlayingNameTheTuneNotItsSource() async throws {
        let rig = rig(["a": recording("a"), "b": try song("b")])
        start(rig, ["a", "b"])
        try await playing(rig, "ra")
        #expect(rig.player.title != "Tune a")
        #expect(rig.playback.title == "Tune a")
        #expect(PlayerBar.title(rig.player, rig.playback) == "Tune a")
        #expect(PlayerBar.showLabel(rig.player, playback: rig.playback).contains("Tune a"))
        rig.audio.end(.finished)
        try await playing(rig, "lb")
        #expect(PlayerBar.title(rig.player, rig.playback) == "Tune b")

        // Played on its own, the bar names what the player holds.
        rig.playback.end()
        #expect(PlayerBar.title(rig.player, rig.playback) == rig.player.title)
    }

    @Test func theBarTitleAndPositionChangeTogetherWhenTheNextTuneLoads() async throws {
        let rig = rig()
        start(rig, ["a", "b"])
        try await playing(rig, "ra")
        rig.resolver.holding = ["b"]
        rig.playback.next()
        try await eventually { rig.resolver.isHolding("b") }
        #expect(rig.playback.currentTuneID == "b")
        #expect(PlayerBar.title(rig.player, rig.playback) == "Tune a")
        #expect(rig.playback.position == 1)
        rig.resolver.release("b")
        try await playing(rig, "rb")
        #expect(PlayerBar.title(rig.player, rig.playback) == "Tune b")
        #expect(rig.playback.position == 2)
    }

    @Test func aSecondNextAtTheEndPausesTheTuneStillPlaying() async throws {
        let rig = rig()
        start(rig, ["a", "b"])
        try await playing(rig, "ra")
        rig.resolver.holding = ["b"]
        rig.playback.next()
        try await eventually { rig.resolver.isHolding("b") }
        rig.playback.next()
        #expect(!rig.playback.isActive)
        #expect(!rig.audio.isPlaying)
        rig.resolver.release("b")
        try await eventually { rig.resolver.answered.contains("b") }
        #expect(rig.player.item?.id == "ra")
    }

    @Test func aZeroLengthTrackDoesNotCountAsPlayed() async throws {
        let rig = rig(["a": recording("a")])
        rig.audio.duration = 0
        rig.playback.cycleRepeat()
        start(rig)
        try await playing(rig, "ra")
        rig.audio.end(.finished)
        try await eventually { self.loads(rig) == 2 && rig.audio.isPlaying }
        rig.audio.end(.finished)
        try await eventually { !rig.playback.isActive }
        #expect(rig.playback.endMessage == ListPlaybackText.nothingLeft)
    }

    @Test func aTrackThatPlayedLetsRepeatGoRound() async throws {
        let rig = rig(["a": recording("a")])
        rig.playback.cycleRepeat()
        start(rig)
        try await playing(rig, "ra")
        for round in 2...3 {
            rig.audio.end(.finished)
            try await eventually { self.loads(rig) == round && rig.audio.isPlaying }
        }
        #expect(rig.playback.isActive)
    }

    @Test func settlesOnceTheNewTuneLoads() async throws {
        let rig = rig()
        start(rig)
        try await playing(rig, "ra")
        #expect(rig.playback.isSettled)
        rig.resolver.holding = ["b"]
        rig.playback.next()
        #expect(!rig.playback.isSettled)
        try await eventually { rig.resolver.isHolding("b") }
        rig.resolver.release("b")
        try await playing(rig, "rb")
        #expect(rig.playback.isSettled)
    }

    @Test func shuffleOnDuringPlayShufflesOnlyTheTunesAhead() async throws {
        let rig = rig()
        start(rig, ["a", "b", "c", "d", "e"], at: "b")
        try await playing(rig, "rb")
        rig.playback.setShuffled(true)
        #expect(rig.playback.isShuffled)
        #expect(rig.playback.position == 2)
        #expect(rig.playback.currentTuneID == "b")
        #expect(self.loads(rig) == 1)
        var played: [String] = []
        for position in 3...5 {
            rig.playback.next()
            try await eventually {
                rig.playback.position == position && rig.audio.isPlaying && self.loads(rig) == position - 1
            }
            played.append(try #require(rig.playback.currentTuneID))
        }
        #expect(played.sorted() == ["c", "d", "e"])
    }

    @Test func shuffleOffDuringPlayGoesOnInListOrder() async throws {
        let rig = rig()
        rig.playback.start(
            listID: "list1", name: listName, tuneIDs: ["a", "b", "c", "d", "e"], shuffled: true, at: "c")
        try await playing(rig, "rc")
        rig.playback.setShuffled(false)
        #expect(!rig.playback.isShuffled)
        #expect(rig.playback.position == 3)
        #expect(self.loads(rig) == 1)
        rig.playback.next()
        try await playing(rig, "rd")
        rig.playback.next()
        try await playing(rig, "re")
    }

    @Test func aJumpWhileTheNextTuneResolvesWins() async throws {
        let rig = rig()
        start(rig)
        try await playing(rig, "ra")
        rig.resolver.holding = ["b"]
        rig.playback.next()
        try await eventually { rig.resolver.isHolding("b") }
        #expect(await rig.playback.jump(to: "c"))
        try await playing(rig, "rc")
        rig.resolver.release("b")
        try await eventually { rig.resolver.answered.contains("b") }
        #expect(rig.player.item?.id == "rc")
        #expect(rig.playback.currentTuneID == "c")
        #expect(rig.playback.position == 3)
    }

    @Test func aSecondStartReplacesTheFirstWhileItResolves() async throws {
        let rig = rig()
        rig.resolver.holding = ["a"]
        start(rig)
        try await eventually { rig.resolver.isHolding("a") }
        rig.playback.start(listID: "list2", name: "Other", tuneIDs: ["c"], shuffled: false)
        try await playing(rig, "rc")
        rig.resolver.release("a")
        try await eventually { rig.resolver.answered.contains("a") }
        #expect(rig.player.item?.id == "rc")
        #expect(rig.playback.listID == "list2")
        #expect(rig.playback.count == 1)
        #expect(self.loads(rig) == 1)
    }
}

/// A list played through reports its start once, and each track as it ends with how it was
/// reached.
@MainActor
@Suite struct PlaylistEventTests {
    private let suite = TemporaryDefaults("PlaylistEventTests")
    private let commands = FakeTrackCommands()

    private func playlist(_ rig: ActivityRig) -> ListPlayback {
        let playback = ListPlayback(
            player: rig.player, commands: commands, defaults: suite.defaults, analytics: rig.sink.client)
        playback.resolve = { _, tuneID in
            ListPlayback.Turn(
                title: "Tune \(tuneID)", item: .recording(loggedTake("r\(tuneID)", tuneID: tuneID), tuneTitle: nil))
        }
        return playback
    }

    /// Waits until recording `id` plays and the play log has heard it.
    private func playing(_ rig: ActivityRig, _ id: String) async throws {
        try await waitFor { rig.audio.isPlaying && rig.player.item?.id == id }
        try await rig.fed { $0.loaded == PlaySubject(kind: .recording, id: id) && $0.playing }
    }

    @Test func playingAListReportsThePlaylistOnceAndEachTrack() async throws {
        let rig = ActivityRig()
        let playback = playlist(rig)
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b", "c"], shuffled: false)
        try await playing(rig, "ra")
        rig.clock.advance(15_000)
        rig.audio.end(.finished)
        try await playing(rig, "rb")
        rig.clock.advance(15_000)
        rig.audio.end(.finished)
        try await waitFor { rig.sent("playback_ended").count == 2 }
        #expect(
            rig.sent("playlist_started") == [
                [
                    "shuffle": .bool(false), "repeat": .string("off"), "count_bucket": .string("1-9"),
                    "list_id": .string("list1"),
                ]
            ])
        let ended = rig.sent("playback_ended")
        #expect(ended.map { $0["queue"] } == [.string("playlist"), .string("playlist")])
        #expect(ended.map { $0["source"] } == [.string("list"), .string("list")])
        #expect(ended.map { $0["trigger"] } == [.string("tap"), .string("auto_advance")])
        #expect(ended.map { $0["ended_by"] } == [.string("finished"), .string("finished")])
        #expect(ended.map { $0["list_id"] } == [.string("list1"), .string("list1")])
        playback.end()
    }

    @Test func aPlaylistReportsItsStartOnceItsFirstTuneLoads() async throws {
        let rig = ActivityRig()
        let playback = playlist(rig)
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b"], shuffled: false)
        #expect(rig.sent("playlist_started").isEmpty)
        try await playing(rig, "ra")
        #expect(rig.sent("playlist_started").count == 1)
        playback.end()
    }

    @Test func aPlaylistWithNothingToPlayReportsNoStart() async throws {
        let rig = ActivityRig()
        let playback = playlist(rig)
        playback.resolve = { _, _ in nil }
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b"], shuffled: false)
        try await waitFor { playback.endMessage == ListPlaybackText.nothingLeft }
        #expect(rig.sent("playlist_started").isEmpty)
    }

    @Test func aPlaylistRefusedDuringATakeReportsNoStart() async throws {
        let rig = ActivityRig()
        rig.player.isCapturing = { true }
        let playback = playlist(rig)
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b"], shuffled: false)
        try await waitFor { !playback.isActive }
        #expect(rig.sent("playlist_started").isEmpty)
    }

    @Test func nextInAPlaylistIsASkip() async throws {
        let rig = ActivityRig()
        let playback = playlist(rig)
        playback.start(listID: "list1", name: "Session", tuneIDs: ["a", "b", "c"], shuffled: false)
        try await playing(rig, "ra")
        rig.clock.advance(5_000)
        commands.pressNext()
        try await playing(rig, "rb")
        rig.clock.advance(12_000)
        playback.end()
        rig.player.close()
        try await waitFor { rig.sent("playback_ended").count == 2 }
        let ended = rig.sent("playback_ended")
        #expect(ended.map { $0["recording_id"] } == [.string("ra"), .string("rb")])
        #expect(ended.first?["ended_by"] == .string("skipped"))
        #expect(ended.last?["trigger"] == .string("skip"))
        #expect(rig.sent("playlist_started").count == 1)
    }
}
