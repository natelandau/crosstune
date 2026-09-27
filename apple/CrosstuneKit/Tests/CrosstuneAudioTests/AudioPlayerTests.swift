@preconcurrency import AVFoundation
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneAudio

@MainActor
private func eventually(_ condition: () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("The condition never held")
}

@Suite struct PlaybackPositionTests {
    @Test func keepsAPositionWithinTheAudio() {
        #expect(clampedPosition(-4, duration: 10) == 0)
        #expect(clampedPosition(4, duration: 10) == 4)
        #expect(clampedPosition(14, duration: 10) == 10)
        #expect(clampedPosition(14, duration: nil) == 14)
    }
}

@Suite struct OutputPortTests {
    private let speaker = OutputPort(type: "Speaker", uid: "Built-In Speaker")
    private let headphones = OutputPort(type: "Headphones", uid: "Wired Headphones")
    private let airPlay = OutputPort(type: "AirPlay", uid: "Kitchen")

    @Test func headphonesRemovedIsALostOutput() {
        #expect(lostAnOutput(recorded: [headphones], current: [speaker]))
    }

    @Test func nothingRemovedIsNot() {
        #expect(!lostAnOutput(recorded: [headphones], current: [headphones]))
        #expect(!lostAnOutput(recorded: [], current: [speaker]))
    }

    @Test func aPortAddedIsNot() {
        #expect(!lostAnOutput(recorded: [speaker], current: [speaker, airPlay]))
    }
}

@MainActor
@Suite struct AudioPlayerTests {
    @Test func loadsAFileAndLearnsItsLengthThenLetsItGo() async throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "tone.aac")
        try writeTone(to: url, seconds: 2)
        let player = AudioPlayer(isCapturing: { false })

        player.load(url, nowPlaying: NowPlaying(title: "Jam at Mike's", tuneTitle: "Kitchen Girl"))
        try await eventually { player.duration != nil }
        let duration = try #require(player.duration)
        #expect(abs(duration - 2) < 0.2)
        #expect(!player.isPlaying)
        #expect(!player.hasFailed)

        player.seek(to: -3)
        #expect(player.elapsed == 0)
        player.seek(to: 60)
        #expect(player.elapsed == duration)
        player.skip(by: -AudioPlayer.skipInterval)
        #expect(player.elapsed == 0)

        player.unload()
        #expect(player.duration == nil)
        #expect(player.elapsed == 0)
        #expect(!player.isPlaying)
    }

    /// A player on the offline renderer, with a 4-second tone loaded.
    private func offlinePlayer(_ root: TemporaryRoot) throws -> AudioPlayer {
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "tone.aac")
        try writeTone(to: url, seconds: 4)
        let player = AudioPlayer(isCapturing: { false }, rendersOffline: true)
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        return player
    }

    @Test func playsOnlyTheWindowOnATrimmedTimeline() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setWindow(PlaybackWindow(from: 1, to: 3))
        let duration = try #require(player.duration)
        #expect(abs(duration - 2) < 0.01)

        player.seek(to: 0)
        #expect(player.elapsed == 0)
        player.play()
        #expect(player.isPlaying)
        try player.render(seconds: 1)
        #expect(player.elapsed > 0.8 && player.elapsed < 1.3)

        // Past the end while playing is the end: paused, back at the start.
        player.seek(to: 60)
        #expect(!player.isPlaying)
        #expect(player.elapsed == 0)
        player.unload()
    }

    @Test func aNewWindowKeepsThePlaceInTheFileAndKeepsPlaying() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setWindow(PlaybackWindow(from: 1, to: 3))
        player.seek(to: 1)
        player.setWindow(PlaybackWindow(from: 0.5, to: 3.5))
        #expect(abs(player.elapsed - 1.5) < 0.001)
        #expect(abs((player.duration ?? 0) - 3) < 0.001)

        player.play()
        player.setWindow(PlaybackWindow(from: 3, to: 4))
        #expect(player.elapsed == 0)
        #expect(player.isPlaying)
        player.unload()
    }

    @Test func halfSpeedHalvesHowFastThePositionMoves() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setRate(50)
        #expect(player.timePitch.rate == 0.5)
        player.play()
        try player.render(seconds: 1)
        #expect(player.elapsed > 0.35 && player.elapsed < 0.7)
        player.setRate(100)
        #expect(player.timePitch.rate == 1)
        #expect(player.isPlaying)
        player.unload()
    }

    @Test func oneAndAHalfSpeedMovesThePositionFaster() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setRate(150)
        #expect(player.timePitch.rate == 1.5)
        player.play()
        try player.render(seconds: 1)
        #expect(player.elapsed > 1.2 && player.elapsed < 1.8)
        player.unload()
    }

    @Test func theEndOfAReplacedSegmentLeavesPlaybackAlone() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.play()
        try player.render(seconds: 1)
        player.seek(to: 0)
        // Past where the first segment, 4 s from the start, would have ended.
        try player.render(seconds: 3.2)
        for _ in 0..<20 { await Task.yield() }
        #expect(player.isPlaying)
        #expect(player.elapsed > 2.9 && player.elapsed < 3.6)
        player.unload()
    }

    @Test func anEngineTheSystemStopsLeavesThePlaceForItsHandlerToPickUp() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.play()
        try player.render(seconds: 1)
        let before = player.elapsed
        player.engine.stop()
        try await Task.sleep(for: .milliseconds(200))
        #expect(player.isPlaying)
        #expect(player.elapsed == before)
        player.unload()
    }

    @Test func aConfigurationChangePlaysOnFromTheSamePlace() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.play()
        try player.render(seconds: 1)
        let before = player.elapsed
        NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: player.engine)
        try await eventually { player.isPlaying && player.engine.isRunning }
        #expect(abs(player.elapsed - before) < 0.001)
        try player.render(seconds: 0.5)
        #expect(player.elapsed > before + 0.3 && player.elapsed < before + 0.8)
        player.unload()
    }

    @Test func aPitchShiftLeavesTheLengthAlone() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let before = player.duration
        player.setPitch(cents: 200)
        #expect(player.timePitch.pitch == 200)
        #expect(player.duration == before)
        player.unload()
    }

    @Test func theEndOfTheWindowPausesBackAtTheStart() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setWindow(PlaybackWindow(from: 1, to: 2))
        player.play()
        try player.render(seconds: 2)
        try await eventually { !player.isPlaying }
        #expect(player.elapsed == 0)
        player.unload()
    }

    @Test func aNewFileStartsWithNoWindowAndNoShift() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setWindow(PlaybackWindow(from: 1, to: 2))
        player.setRate(75)
        player.setPitch(cents: -300)
        player.load(root.url.appending(path: "tone.aac"), nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        #expect(abs((player.duration ?? 0) - 4) < 0.2)
        #expect(player.timePitch.rate == 1)
        #expect(player.timePitch.pitch == 0)
        player.unload()
    }

    @Test func staysSilentWhileATakeIsRecorded() async throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "tone.aac")
        try writeTone(to: url, seconds: 1)
        let player = AudioPlayer(isCapturing: { true })
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        player.play()
        #expect(!player.isPlaying)
        player.unload()
    }

    @Test func aPlayThatDoesNotStartPublishesTheStoppedStateOnce() async throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "tone.aac")
        try writeTone(to: url, seconds: 1)
        var capturing = true
        let player = AudioPlayer(isCapturing: { capturing }, rendersOffline: true)
        var published: [PublishedPlayback] = []
        player.publishes = { published.append($0) }
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))

        // Refused while a take is recorded.
        published = []
        player.play()
        #expect(!player.isPlaying)
        #expect(published.map(\.isPlaying) == [false])

        // Refused for a file that failed.
        capturing = false
        let broken = root.url.appending(path: "broken.m4a")
        try Data("not audio".utf8).write(to: broken)
        player.load(broken, nowPlaying: NowPlaying(title: "Broken", tuneTitle: nil))
        #expect(player.hasFailed)
        published = []
        player.play()
        #expect(published.map(\.isPlaying) == [false])

        // A play that starts publishes once too, as playing.
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        published = []
        player.play()
        #expect(player.isPlaying)
        #expect(published.map(\.isPlaying) == [true])
        player.unload()
    }

    @Test func failsAFileThatIsNotAudio() async throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "broken.m4a")
        try Data("not audio".utf8).write(to: url)
        let player = AudioPlayer(isCapturing: { false })
        player.load(url, nowPlaying: NowPlaying(title: "Broken", tuneTitle: nil))
        try await eventually { player.hasFailed }
        player.play()
        #expect(!player.isPlaying)
        player.unload()
        #expect(!player.hasFailed)
    }
}

@MainActor
@Suite struct UnfinishedCaptureTests {
    @Test func discardsALeftoverCaptureButNeverOneBeingRecorded() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = newID()
        try await Commands(store: store).beginCapture(
            id, fileName: CaptureFiles.captureName(id), tuneID: nil, recordedAt: noon)
        let capture = CaptureFinisher(store: store).captureURL(id)
        try writeTone(to: capture, seconds: 1)
        let row = { try await store.read { db in try RecordingFile.fetchOne(db, key: id) } }

        Recorder.active.insert(id)
        #expect(Recorder.isRecording(id))
        try await Recorder.discardUnfinishedCapture(id, in: store)
        #expect(try await row() != nil)
        #expect(fileExists(capture))

        Recorder.active.remove(id)
        #expect(!Recorder.isRecording(id))
        try await Recorder.discardUnfinishedCapture(id, in: store)
        #expect(try await row() == nil)
        #expect(!fileExists(capture))
    }
}
