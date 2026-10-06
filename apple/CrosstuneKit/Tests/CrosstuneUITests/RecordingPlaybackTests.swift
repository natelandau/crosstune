import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Observation
import Synchronization
import Testing

@testable import CrosstuneUI

/// Stands in for the device's player, noting what the model asked of it. Observable, as the
/// device's player is, so the player's activity log hears it start and stop.
@MainActor
@Observable
final class FakeAudio: AudioPlayback {
    var isPlaying = false
    var elapsed: TimeInterval = 0
    var duration: TimeInterval?
    var hasFailed = false
    var isRepeating = false
    private(set) var loaded: URL?
    /// Whether the last load kept Repeat and the loop.
    private(set) var keptLoop: Bool?
    private(set) var loop: PlaybackWindow?
    private(set) var nowPlaying: NowPlaying?
    private(set) var window: PlaybackWindow?
    private(set) var calls: [String] = []
    var onTrackEnd: (@MainActor (TrackEnd) -> Void)?
    var skipsByInterval = true
    var holdsSession = false

    /// Ends the track on its own, paused, as the device's player does.
    func end(_ end: TrackEnd) {
        isPlaying = false
        onTrackEnd?(end)
    }

    func yieldSessionToMusic() {
        calls.append("yieldSessionToMusic")
    }

    func releaseSession() {
        calls.append("releaseSession")
    }

    func load(_ url: URL, nowPlaying: NowPlaying, keepLoop: Bool) {
        loaded = url
        self.nowPlaying = nowPlaying
        keptLoop = keepLoop
        loop = nil
        if !keepLoop { isRepeating = false }
        calls.append("load")
    }

    func retitle(_ nowPlaying: NowPlaying) {
        self.nowPlaying = nowPlaying
        calls.append("retitle")
    }

    func play() {
        isPlaying = true
        calls.append("play")
    }

    func pause() {
        isPlaying = false
        calls.append("pause")
    }

    func seek(to seconds: TimeInterval) {
        elapsed = seconds
        calls.append("seek")
    }

    func setWindow(_ window: PlaybackWindow?) {
        self.window = window
        calls.append("setWindow")
    }

    func setLoop(_ loop: PlaybackWindow?) {
        self.loop = loop
        calls.append("setLoop")
    }

    func setRepeat(_ on: Bool) {
        isRepeating = on
        calls.append("setRepeat(\(on))")
    }

    func setRate(_ percent: Int) {
        calls.append("setRate(\(percent))")
    }

    func setPitch(cents: Int) {
        calls.append("setPitch(\(cents))")
    }

    func unload() {
        loaded = nil
        nowPlaying = nil
        isPlaying = false
        calls.append("unload")
    }
}

/// Answers each fetch when the test says, so a test can hold one in flight.
@MainActor
private final class HeldSource {
    private var waiting: [String: CheckedContinuation<RecordingAudioFile?, Never>] = [:]
    private(set) var asked: [String] = []

    func fetch(_ recordingID: String) async -> RecordingAudioFile? {
        asked.append(recordingID)
        return await withCheckedContinuation { waiting[recordingID] = $0 }
    }

    func answer(_ recordingID: String, with url: URL?) {
        waiting.removeValue(forKey: recordingID)?.resume(returning: url.map(playable))
    }
}

@MainActor
private func eventually(_ condition: () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("The condition never held")
}

private let audioURL = URL(filePath: "/tmp/r1.m4a")

private func playable(_ url: URL = audioURL) -> RecordingAudioFile {
    RecordingAudioFile(url: url, file: RecordingFile(id: "r1", localState: .downloaded))
}

/// What the player asks of the audio to load a recording at its row's defaults and start it.
private let loadAndPlay = ["load", "setWindow", "setRate(100)", "setPitch(0)", "play"]

private func recording(_ id: String = "r1", label: String? = "Jam at Mike's") -> Recording {
    Recording(id: id, tuneID: "t1", source: "microphone", addedAt: noon, label: label, state: "ready")
}

@MainActor
@Suite struct RecordingPlaybackTests {
    @Test func fetchesARecordingsAudioThenPlaysItNamedForItsTune() async throws {
        let audio = FakeAudio()
        let source = HeldSource()
        let player = PlayerModel(audio: audio)
        player.audioSource = source.fetch

        player.play(.recording(recording(), tuneTitle: "Kitchen Girl"))
        #expect(player.recordingAudio == .fetching)
        try await eventually { source.asked == ["r1"] }
        #expect(audio.calls.isEmpty)

        source.answer("r1", with: audioURL)
        try await eventually { player.recordingAudio == .loaded }
        #expect(audio.loaded == audioURL)
        #expect(audio.keptLoop == false)
        #expect(audio.nowPlaying == NowPlaying(title: "Jam at Mike's", tuneTitle: "Kitchen Girl"))
        #expect(audio.calls == loadAndPlay)
        #expect(audio.isPlaying)
    }

    @Test func controlsARecordingOnlyOnceItsAudioPlays() async throws {
        let audio = FakeAudio()
        let source = HeldSource()
        let player = PlayerModel(audio: audio)
        player.audioSource = source.fetch
        #expect(player.transport == nil)

        player.play(.recording(recording(), tuneTitle: nil))
        try await eventually { source.asked == ["r1"] }
        #expect(player.transport == nil)

        source.answer("r1", with: audioURL)
        try await eventually { player.recordingAudio == .loaded }
        #expect(player.transport === audio)

        audio.hasFailed = true
        #expect(player.transport == nil)
    }

    @Test func saysARecordingIsUnavailableWhenNothingIsFetchedAndTriesAgain() async throws {
        let audio = FakeAudio()
        let source = HeldSource()
        let player = PlayerModel(audio: audio)
        player.audioSource = source.fetch
        player.play(.recording(recording(), tuneTitle: nil))
        try await eventually { source.asked.count == 1 }
        source.answer("r1", with: nil)
        try await eventually { player.recordingAudio == .unavailable }
        #expect(audio.calls.isEmpty)
        #expect(player.isLoaded)

        player.retryAudio()
        #expect(player.recordingAudio == .fetching)
        try await eventually { source.asked.count == 2 }
        source.answer("r1", with: audioURL)
        try await eventually { player.recordingAudio == .loaded }
    }

    @Test func looksAgainOnceTheShellGivesItSomewhereToFindAudio() async throws {
        let audio = FakeAudio()
        let player = PlayerModel(audio: audio)
        player.play(.recording(recording(), tuneTitle: nil))
        try await eventually { player.recordingAudio == .unavailable }

        player.audioSource = { _ in playable() }
        try await eventually { player.recordingAudio == .loaded }
        #expect(audio.calls == loadAndPlay)
    }

    @Test func dropsAFetchForARecordingNoLongerLoaded() async throws {
        let audio = FakeAudio()
        let source = HeldSource()
        let player = PlayerModel(audio: audio)
        player.audioSource = source.fetch
        player.play(.recording(recording("r1"), tuneTitle: nil))
        try await eventually { source.asked == ["r1"] }
        player.play(.recording(recording("r2"), tuneTitle: nil))
        try await eventually { source.asked == ["r1", "r2"] }

        source.answer("r1", with: URL(filePath: "/tmp/old.m4a"))
        try await Task.sleep(for: .milliseconds(50))
        #expect(audio.loaded == nil)
        #expect(player.recordingAudio == .fetching)

        source.answer("r2", with: audioURL)
        try await eventually { player.recordingAudio == .loaded }
        #expect(audio.loaded == audioURL)
    }

    @Test func playsOneThingAtATime() async throws {
        let audio = FakeAudio()
        let player = PlayerModel(audio: audio)
        player.audioSource = { _ in playable() }
        player.play(.recording(recording(), tuneTitle: nil))
        try await eventually { player.recordingAudio == .loaded }

        // A link's player takes over, and the recording stops.
        var link = RecordingLink(id: "l1", tuneID: "t1", url: "https://example.com/x", provider: "youtube")
        link.providerRef = "dQw4w9WgXcQ"
        player.play(try #require(PlayerItem.link(link)))
        #expect(audio.calls.last == "unload")
        #expect(player.recordingAudio == nil)
        #expect(player.item?.link != nil)

        player.play(.recording(recording(), tuneTitle: nil))
        try await eventually { player.recordingAudio == .loaded }
        player.close()
        #expect(audio.calls.last == "unload")
        #expect(!audio.isPlaying)
        #expect(player.recordingAudio == nil)
    }

    @Test func refusesToPlayAnythingWhileATakeIsRecorded() async throws {
        let audio = FakeAudio()
        let player = PlayerModel(audio: audio)
        player.audioSource = { _ in playable() }
        let capturing = Mutex(true)
        player.isCapturing = { capturing.withLock { $0 } }

        #expect(!player.play(.recording(recording(), tuneTitle: nil)))
        var link = RecordingLink(id: "l1", tuneID: "t1", url: "https://example.com/x", provider: "youtube")
        link.providerRef = "dQw4w9WgXcQ"
        #expect(!player.play(try #require(PlayerItem.link(link))))
        #expect(!player.isLoaded)
        #expect(audio.calls.isEmpty)

        capturing.withLock { $0 = false }
        #expect(player.play(.recording(recording(), tuneTitle: nil)))
        try await eventually { player.recordingAudio == .loaded }
        #expect(audio.calls == loadAndPlay)
    }

    @Test func holdsFetchedAudioSilentWhenATakeStartsMeanwhile() async throws {
        let audio = FakeAudio()
        let source = HeldSource()
        let player = PlayerModel(audio: audio)
        player.audioSource = source.fetch
        let capturing = Mutex(false)
        player.isCapturing = { capturing.withLock { $0 } }
        player.play(.recording(recording(), tuneTitle: nil))
        try await eventually { source.asked.count == 1 }
        capturing.withLock { $0 = true }
        source.answer("r1", with: audioURL)
        try await eventually { player.recordingAudio == .loaded }
        #expect(audio.calls == Array(loadAndPlay.dropLast()))
        #expect(!audio.isPlaying)
    }

    @Test func followsTheLoadedRecordingsRowAndClosesOnceItIsDeleted() async throws {
        let audio = FakeAudio()
        let player = PlayerModel(audio: audio)
        player.audioSource = { _ in playable() }
        player.play(.recording(recording(), tuneTitle: "Kitchen Girl"))
        try await eventually { player.recordingAudio == .loaded }

        player.recordingChanged(
            id: "r1", to: recording(label: "Take 2"), audioFile: playable(), tuneTitle: "Kitchen Girl")
        #expect(player.title == "Take 2")
        #expect(audio.nowPlaying == NowPlaying(title: "Take 2", tuneTitle: "Kitchen Girl"))
        #expect(audio.isPlaying)

        // Another recording changing leaves the loaded one alone.
        player.recordingChanged(id: "r2", to: nil, audioFile: nil, tuneTitle: nil)
        #expect(player.isLoaded)

        var deleted = recording(label: "Take 2")
        deleted.deletedAt = .now
        player.recordingChanged(id: "r1", to: deleted, audioFile: nil, tuneTitle: nil)
        #expect(!player.isLoaded)
        #expect(audio.calls.last == "unload")
    }

    @Test(arguments: [
        (RecordingAudio.fetching, false, false, Optional("Downloading")),
        (.unavailable, false, false, "Couldn't download"),
        (.unavailable, false, true, "Offline"),
        (.loaded, false, false, nil),
        (.loaded, true, false, "Couldn't play"),
    ])
    func saysWhereTheAudioStands(audio: RecordingAudio, failed: Bool, offline: Bool, expected: String?) {
        #expect(RecordingPlayerText.status(audio, hasFailed: failed, offline: offline) == expected)
    }

    @Test func writesPositionsAsAPlayerDoes() {
        #expect(PlayerTime.clock(0) == "0:00")
        #expect(PlayerTime.clock(61.9) == "1:01")
        #expect(PlayerTime.clock(3_725) == "1:02:05")
        #expect(PlayerTime.clock(-3) == "0:00")
        #expect(PlayerTime.remaining(60.2, of: 184) == "-2:04")
        #expect(PlayerTime.remaining(184, of: 184) == "-0:00")
        #expect(PlayerTime.spoken(62, of: 184) == "1:02 of 3:04")
        #expect(PlayerTime.spoken(62, of: nil) == "1:02")
    }
}
