@preconcurrency import AVFoundation
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import MediaPlayer
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

    @Test func offersIntervalSkipsAgainWhenTheyAreTurnedBackOnWhileLoaded() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let center = MPRemoteCommandCenter.shared()
        #expect(center.skipForwardCommand.isEnabled)
        player.unload()

        player.skipsByInterval = false
        player.load(
            root.url.appending(path: "tone.aac"), nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        #expect(!center.skipForwardCommand.isEnabled)
        #expect(!center.skipBackwardCommand.isEnabled)

        player.skipsByInterval = true
        #expect(center.skipForwardCommand.isEnabled)
        #expect(center.skipBackwardCommand.isEnabled)
        player.unload()
        #expect(!center.skipForwardCommand.isEnabled)
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

    @Test func reachingTheEndReportsFinishedOnce() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        var ends: [TrackEnd] = []
        player.onTrackEnd = { ends.append($0) }

        // Pausing and seeking within the track never end it.
        player.play()
        try player.render(seconds: 0.5)
        player.pause()
        player.seek(to: 1)
        player.play()
        #expect(ends.isEmpty)

        player.seek(to: 3.5)
        try player.render(seconds: 1)
        try await eventually { ends.count == 1 }
        #expect(ends == [.finished])
        #expect(!player.isPlaying)

        player.play()
        try player.render(seconds: 0.5)
        player.unload()
        for _ in 0..<20 { await Task.yield() }
        #expect(ends == [.finished])
    }

    @Test func aSeekToTheEndWhilePlayingFinishesTheTrack() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        var ends: [TrackEnd] = []
        player.onTrackEnd = { ends.append($0) }

        player.play()
        try player.render(seconds: 0.5)
        player.seek(to: 60)

        #expect(ends == [.finished])
        #expect(!player.isPlaying)
        player.unload()
    }

    @Test func aSeekToTheEndWhilePausedLeavesTheTrackUnfinished() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        var ends: [TrackEnd] = []
        player.onTrackEnd = { ends.append($0) }

        player.play()
        try player.render(seconds: 0.5)
        player.pause()
        player.seek(to: 60)

        #expect(ends.isEmpty)
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

    /// Renders `seconds` in short steps, letting each step's segment completions land.
    private func renderInSteps(_ player: AudioPlayer, seconds: TimeInterval) async throws {
        var left = seconds
        while left > 0 {
            try player.render(seconds: min(left, 0.25))
            left -= 0.25
            for _ in 0..<20 { await Task.yield() }
        }
    }

    @Test func aRepeatingLoopWrapsBackInsideItAndNeverStops() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        var ends: [TrackEnd] = []
        player.onTrackEnd = { ends.append($0) }
        let loop = PlaybackWindow(from: 1, to: 2)
        player.setLoop(loop)
        player.setRepeat(true)
        #expect(player.isRepeating)
        player.seek(to: 1.5)
        player.play()
        // Half a second to the loop end, then three times round the loop and more.
        for _ in 0..<13 {
            try await renderInSteps(player, seconds: 0.25)
            #expect(player.isPlaying)
            #expect(player.elapsed >= loop.from && player.elapsed <= loop.to)
        }
        #expect(player.elapsed > 1.6 && player.elapsed < 2)
        #expect(ends.isEmpty)
        player.unload()
    }

    @Test func playWithRepeatFromOutsideTheLoopStartsAtItsStart() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setRepeat(true)
        player.setLoop(PlaybackWindow(from: 2, to: 3))
        #expect(player.elapsed == 2)
        player.seek(to: 0.5)
        #expect(player.elapsed == 0.5)
        player.play()
        #expect(player.elapsed == 2)
        try player.render(seconds: 0.4)
        #expect(player.elapsed > 2.1 && player.elapsed < 2.7)
        player.unload()
    }

    @Test func aLoopMovedAwayFromTheRepeatingPlayheadTakesItToTheNewStart() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setLoop(PlaybackWindow(from: 1, to: 2))
        player.setRepeat(true)
        player.seek(to: 1.5)
        player.play()
        try player.render(seconds: 0.2)
        player.setLoop(PlaybackWindow(from: 2.5, to: 3.5))
        #expect(player.elapsed == 2.5)
        #expect(player.isPlaying)
        try await renderInSteps(player, seconds: 1.5)
        #expect(player.isPlaying)
        #expect(player.elapsed > 2.6 && player.elapsed < 3.5)
        player.unload()
    }

    @Test func repeatOffOrNoLoopNeverMovesThePlayheadAndPlaysOnPastTheLoop() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setLoop(PlaybackWindow(from: 1, to: 1.5))
        player.setRepeat(true)
        player.seek(to: 1.2)
        player.play()
        player.setRepeat(false)
        #expect(!player.isRepeating)
        #expect(abs(player.elapsed - 1.2) < 0.05)
        try await renderInSteps(player, seconds: 1)
        #expect(player.elapsed > 1.9)

        // On from past the loop enters it; taking the loop away then leaves the playhead there.
        player.setRepeat(true)
        #expect(player.elapsed == 1)
        let entered = player.elapsed
        player.setLoop(nil)
        #expect(abs(player.elapsed - entered) < 0.05, "\(player.elapsed) vs \(entered)")
        player.unload()
    }

    @Test func aRepeatingLoopAtOneAndAHalfSpeedStaysInsideIt() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let loop = PlaybackWindow(from: 1, to: 2)
        player.setRate(150)
        player.setLoop(loop)
        player.setRepeat(true)
        player.play()
        // 2.5 s of output is 3.75 s of audio: nearly four passes of the loop.
        for _ in 0..<10 {
            try await renderInSteps(player, seconds: 0.25)
            #expect(player.isPlaying)
            #expect(player.elapsed >= loop.from && player.elapsed <= loop.to)
        }
        #expect(player.timePitch.rate == 1.5)
        player.unload()
    }

    @Test func aConfigurationChangeMidLoopKeepsRepeatingInsideIt() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let loop = PlaybackWindow(from: 1, to: 2)
        player.setLoop(loop)
        player.setRepeat(true)
        player.seek(to: 1.5)
        player.play()
        try await renderInSteps(player, seconds: 0.75)
        let before = player.elapsed
        #expect(before >= loop.from && before <= loop.to)
        NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: player.engine)
        try await eventually { player.isPlaying && player.engine.isRunning }
        #expect(abs(player.elapsed - before) < 0.001)
        for _ in 0..<8 {
            try await renderInSteps(player, seconds: 0.25)
            #expect(player.isPlaying)
            #expect(player.elapsed >= loop.from && player.elapsed <= loop.to)
        }
        player.unload()
    }

    @Test func aKeptLoadThatFailsTurnsRepeatOff() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setLoop(PlaybackWindow(from: 1, to: 2))
        player.setRepeat(true)
        let broken = root.url.appending(path: "broken.m4a")
        try Data("not audio".utf8).write(to: broken)
        player.load(broken, nowPlaying: NowPlaying(title: "Broken", tuneTitle: nil), keepLoop: true)
        #expect(player.hasFailed)
        #expect(!player.isRepeating)
        player.unload()
    }

    @Test func aNewFileClearsTheLoopAndRepeatUnlessItKeepsThem() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let url = root.url.appending(path: "tone.aac")
        player.setLoop(PlaybackWindow(from: 1, to: 1.5))
        player.setRepeat(true)
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        #expect(!player.isRepeating)
        player.play()
        try await renderInSteps(player, seconds: 2)
        #expect(player.elapsed > 1.7)

        // Kept: Repeat stays on, but the old range waits for a new one before it wraps.
        player.setLoop(PlaybackWindow(from: 1, to: 1.5))
        player.setRepeat(true)
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil), keepLoop: true)
        #expect(player.isRepeating)
        #expect(player.elapsed == 0)
        player.play()
        #expect(player.elapsed == 0)
        try await renderInSteps(player, seconds: 2)
        #expect(player.elapsed > 1.7)
        player.setLoop(PlaybackWindow(from: 1, to: 1.5))
        #expect(player.elapsed == 1)
        player.unload()
    }

    @Test func eachWrapTellsNowPlayingTheNewPosition() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        var published: [PublishedPlayback] = []
        player.publishes = { published.append($0) }
        let loop = PlaybackWindow(from: 1, to: 1.5)
        player.setLoop(loop)
        player.setRepeat(true)
        player.play()
        published = []
        // Three wraps of a half-second loop played from its start.
        try await renderInSteps(player, seconds: 1.6)
        #expect(published.count >= 3)
        #expect(published.allSatisfy { $0.isPlaying && $0.elapsed >= loop.from && $0.elapsed <= loop.to })
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
