@preconcurrency import AVFoundation
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import MediaPlayer
import Synchronization
import Testing

@testable import CrosstuneAudio

struct PlaybackPositionTests {
    @Test func keepsAPositionWithinTheAudio() {
        #expect(clampedPosition(-4, duration: 10) == 0)
        #expect(clampedPosition(4, duration: 10) == 4)
        #expect(clampedPosition(14, duration: 10) == 10)
        #expect(clampedPosition(14, duration: nil) == 14)
    }
}

struct OutputPortTests {
    private let speaker = OutputPort(type: "Speaker", uid: "Built-In Speaker")
    private let headphones = OutputPort(type: "Headphones", uid: "Wired Headphones")
    private let airPlay = OutputPort(type: "AirPlay", uid: "Kitchen")

    @Test func headphonesRemovedIsALostOutput() {
        #expect(lostAnOutput(recorded: [headphones], current: [speaker]))
    }

    @Test func nothingRemovedIsNot() {
        #expect(lostAnOutput(recorded: [headphones], current: [headphones]) == false)
        #expect(lostAnOutput(recorded: [], current: [speaker]) == false)
    }

    @Test func aPortAddedIsNot() {
        #expect(lostAnOutput(recorded: [speaker], current: [speaker, airPlay]) == false)
    }
}

@MainActor
@Suite(.timeLimit(.minutes(1))) struct AudioPlayerTests {
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
        #expect(player.isPlaying == false)
        #expect(player.hasFailed == false)

        player.seek(to: -3)
        #expect(player.elapsed == 0)
        player.seek(to: 60)
        #expect(player.elapsed == duration)
        player.skip(by: -AudioPlayer.skipInterval)
        #expect(player.elapsed == 0)

        player.unload()
        #expect(player.duration == nil)
        #expect(player.elapsed == 0)
        #expect(player.isPlaying == false)
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
        #expect(center.skipForwardCommand.isEnabled == false)
        #expect(center.skipBackwardCommand.isEnabled == false)

        player.skipsByInterval = true
        #expect(center.skipForwardCommand.isEnabled)
        #expect(center.skipBackwardCommand.isEnabled)
        player.unload()
        #expect(center.skipForwardCommand.isEnabled == false)
    }

    @Test func everyRemoteCommandTellsThePlayerItCameFromTheSystem() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let controls = try #require(player.nowPlayingControls)
        let center = MPRemoteCommandCenter.shared()
        let told = Mutex(0)
        player.onSystemCommand = { told.withLock { $0 += 1 } }

        let commands: [MPRemoteCommand] = [
            center.playCommand, center.pauseCommand, center.togglePlayPauseCommand, center.skipBackwardCommand,
            center.skipForwardCommand, center.changePlaybackPositionCommand,
        ]
        for (index, command) in commands.enumerated() {
            let status = controls.perform(command)
            #expect(status == .success)
            #expect(told.withLock { $0 } == index + 1)
        }
        player.unload()
    }

    @Test func theSystemsPositionCommandSeeks() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let controls = try #require(player.nowPlayingControls)
        let center = MPRemoteCommandCenter.shared()

        #expect(controls.perform(center.changePlaybackPositionCommand, position: 2.5) == .success)
        #expect(abs(player.elapsed - 2.5) < 0.001)
        // A position command with no position leaves the place alone.
        #expect(controls.perform(center.changePlaybackPositionCommand) == .success)
        #expect(abs(player.elapsed - 2.5) < 0.001)
        player.unload()
    }

    /// Waits until the main actor has handled every segment end the node has rendered past.
    private func segmentEndsHandled(_ player: AudioPlayer, sourceLocation: SourceLocation = #_sourceLocation)
        async throws
    {
        try await eventually(sourceLocation: sourceLocation) {
            player.hasHandledRenderedSegmentEnds
        }
    }

    /// A player on the offline renderer, with a 4-second tone loaded.
    private func offlinePlayer(_ root: TemporaryRoot, channels: Int = 1) throws -> AudioPlayer {
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "tone.aac")
        try writeTone(to: url, seconds: 4, channels: channels)
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
        #expect(player.isPlaying == false)
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
        try await segmentEndsHandled(player)
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
        try await segmentEndsHandled(player)
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

    @Test func aConfigurationChangeKeepsTheIsolateConnected() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.play()
        let dry = rms(try player.render(seconds: 0.5).suffix(11_025))
        player.setIsolate(highBand, isMono: false)
        NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: player.engine)
        try await eventually { player.isPlaying && player.engine.isRunning }
        let isolateNode = try #require(player.isolateNode)
        #expect(player.engine.inputConnectionPoint(for: isolateNode, inputBus: 0)?.node is AVAudioPlayerNode)
        #expect(player.engine.inputConnectionPoint(for: player.timePitch, inputBus: 0)?.node === isolateNode)
        let wet = rms(try player.render(seconds: 1).suffix(22_050))
        #expect(decibels(wet / dry) < -30)
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
        #expect(player.isPlaying == false)

        player.play()
        try player.render(seconds: 0.5)
        player.unload()
        try await segmentEndsHandled(player)
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
        #expect(player.isPlaying == false)
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
            try await segmentEndsHandled(player)
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
        #expect(player.isRepeating == false)
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
        #expect(player.isRepeating == false)
        player.unload()
    }

    @Test func aNewFileClearsTheLoopAndRepeatUnlessItKeepsThem() async throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let url = root.url.appending(path: "tone.aac")
        player.setLoop(PlaybackWindow(from: 1, to: 1.5))
        player.setRepeat(true)
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        #expect(player.isRepeating == false)
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

    @Test func staysSilentWhileARecordingIsRecorded() async throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "tone.aac")
        try writeTone(to: url, seconds: 1)
        let player = AudioPlayer(isCapturing: { true })
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        player.play()
        #expect(player.isPlaying == false)
        player.unload()
    }

    @Test func aPlayThatDoesNotStartPublishesTheStoppedStateOnce() async throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "tone.aac")
        try writeTone(to: url, seconds: 1)
        let capturing = Mutex(true)
        let player = AudioPlayer(isCapturing: { capturing.withLock { $0 } }, rendersOffline: true)
        var published: [PublishedPlayback] = []
        player.publishes = { published.append($0) }
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))

        // Refused while a recording is recorded.
        published = []
        player.play()
        #expect(player.isPlaying == false)
        #expect(published.map(\.isPlaying) == [false])

        // Refused for a file that failed.
        capturing.withLock { $0 = false }
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

    // MARK: Isolate

    /// Solo 2 to 8 kHz, which holds none of the 440 Hz test tone.
    private let highBand = IsolateSetting(effect: .solo, panStart: -100, panEnd: 100, lowHz: 2_000, highHz: 8_000)

    @Test func setIsolateEngagesTheUnitWhenNotDefault() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let isolate = try #require(player.isolate)
        #expect(isolate.isEngaged == false)
        #expect(player.isolateOutline == nil)
        player.setIsolate(highBand, isMono: false)
        #expect(isolate.isEngaged)
        player.setIsolate(.standard, isMono: false)
        #expect(isolate.isEngaged == false)
        player.setIsolateOutlineWanted(true)
        #expect(isolate.isEngaged)
        player.setIsolateOutlineWanted(false)
        #expect(isolate.isEngaged == false)
        player.unload()
    }

    @Test func aPanOnlySettingLeavesTheUnitBypassedForMonoAudio() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        let isolate = try #require(player.isolate)
        let leftHalf = IsolateSetting(effect: .solo, panStart: -100, panEnd: 0, lowHz: 40, highHz: 16000)
        player.setIsolate(leftHalf, isMono: true)
        #expect(isolate.isEngaged == false)
        player.setIsolate(leftHalf, isMono: false)
        #expect(isolate.isEngaged)
        player.unload()
    }

    @Test func aNewFileResetsTheIsolateToDefault() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root)
        player.setIsolate(highBand, isMono: true)
        player.load(root.url.appending(path: "tone.aac"), nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        let isolate = try #require(player.isolate)
        #expect(isolate.setting == .standard)
        #expect(isolate.isMono == false)
        #expect(isolate.isEngaged == false)
        player.unload()
    }

    @Test func defaultIsolateLeavesTheRenderedToneUnchanged() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root, channels: 2)
        player.play()
        let dry = rms(try player.render(seconds: 1).suffix(22_050))
        player.setIsolateOutlineWanted(true)
        let wet = rms(try player.render(seconds: 1).suffix(22_050))
        #expect(abs(decibels(wet / dry)) < 0.1, "\(decibels(wet / dry)) dB")
        #expect(player.isolateOutline?.freq.contains(1) == true)
        player.unload()
    }

    @Test func anEngageShowsNoOutlineUntilTheUnitHasRenderedSince() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root, channels: 2)
        player.play()
        player.setIsolateOutlineWanted(true)
        _ = try player.render(seconds: 0.5)
        #expect(player.isolateOutline != nil)
        player.setIsolateOutlineWanted(false)
        _ = try player.render(seconds: 0.5)

        player.setIsolateOutlineWanted(true)
        #expect(player.isolateOutline == nil)
        _ = try player.render(seconds: 0.1)
        #expect(player.isolateOutline != nil)
        player.unload()
    }

    @Test func soloBandRejectsAnOutOfBandTone() throws {
        let root = TemporaryRoot()
        let player = try offlinePlayer(root, channels: 2)
        player.play()
        let dry = rms(try player.render(seconds: 0.5).suffix(11_025))
        player.setIsolate(highBand, isMono: false)
        let wet = rms(try player.render(seconds: 1).suffix(22_050))
        #expect(decibels(wet / dry) < -30, "\(decibels(wet / dry)) dB")
        player.unload()
    }

    @Test func binFrequenciesFollowTheFilesSampleRate() throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "tone.aac")
        // The recorder writes 48 kHz, where a mask that assumed 44.1 kHz would place this tone
        // near 4040 Hz, inside the band's upper edge at about -9 dB.
        try writeTone(to: url, seconds: 4, channels: 2, frequency: 4_400)
        #expect(CaptureWriter.sampleRate == 48_000)
        let player = AudioPlayer(isCapturing: { false }, rendersOffline: true)
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        player.play()
        let dry = rms(try player.render(seconds: 0.5).suffix(11_025))
        player.setIsolate(
            IsolateSetting(effect: .solo, panStart: -100, panEnd: 100, lowHz: 40, highHz: 4_000), isMono: false)
        let wet = rms(try player.render(seconds: 1).suffix(22_050))
        #expect(decibels(wet / dry) < -30, "\(decibels(wet / dry)) dB")
        player.unload()
    }

    @Test func engagingAndBypassingKeepTheLevelSteady() throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "noise.aac")
        try writeNoise(to: url, seconds: 4)
        let player = AudioPlayer(isCapturing: { false }, rendersOffline: true)
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        player.play()
        let dry = rms(try player.render(seconds: 0.5).suffix(11_025))

        player.setIsolateOutlineWanted(true)
        let engaging = try player.render(seconds: 0.4)
        player.setIsolateOutlineWanted(false)
        let bypassing = try player.render(seconds: 0.4)

        // Noise, because a tone and its copy one mask latency later can cancel mid-crossfade.
        for (name, samples) in [("engaging", engaging), ("bypassing", bypassing)] {
            let levels = stride(from: 0, to: samples.count - 220, by: 220).map {
                decibels(rms(samples[$0..<$0 + 220]) / dry)
            }
            #expect(levels.allSatisfy { $0 > -3 && $0 < 3 }, "\(name): \(levels.min() ?? 0) to \(levels.max() ?? 0) dB")
        }
        player.unload()
    }

    @Test(arguments: [true, false]) func aSeekMidFadeKeepsTheLevelSteady(engaging: Bool) throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "noise.aac")
        try writeNoise(to: url, seconds: 4)
        let player = AudioPlayer(isCapturing: { false }, rendersOffline: true)
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        player.setIsolateOutlineWanted(!engaging)
        player.play()
        let dry = rms(try player.render(seconds: 0.5).suffix(11_025))

        player.setIsolateOutlineWanted(engaging)
        // Engaging first stays dry for the mask's latency, one offline block; 20 ms more is
        // partway through the 50 ms crossfade either way.
        if engaging { try player.render(seconds: 0.065) }
        try player.render(seconds: 0.02)
        player.seek(to: 2)
        let after = try player.render(seconds: 0.3).dropFirst(64)

        let levels = stride(from: after.startIndex, to: after.endIndex - 220, by: 220).map {
            decibels(rms(after[$0..<$0 + 220]) / dry)
        }
        #expect(levels.allSatisfy { $0 > -3 && $0 < 3 }, "\(levels.min() ?? 0) to \(levels.max() ?? 0) dB")
        player.unload()
    }

    @Test func seekResetsTheIsolate() throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "tone-then-silence.aac")
        let writer = try CaptureWriter(url: url, bitrate: 64_000, channels: 2)
        for step in 0..<40 { try writer.write(sineBuffer(seconds: 0.1, amplitude: step < 20 ? 0.5 : 0)) }
        writer.close()
        let player = AudioPlayer(isCapturing: { false }, rendersOffline: true)
        player.load(url, nowPlaying: NowPlaying(title: "Take", tuneTitle: nil))
        player.setIsolateOutlineWanted(true)
        player.play()
        let tone = try player.render(seconds: 1)
        #expect(peak(tone.suffix(4_410)) > 0.3)

        // The mask holds 2048 frames, over 40 ms, of the tone; only a reset drops them. The
        // mixer carries a few samples across any jump.
        player.seek(to: 3)
        let after = try player.render(seconds: 0.04).dropFirst(64)
        #expect(peak(after) < 0.01, "\(peak(after))")
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
        #expect(player.isPlaying == false)
        player.unload()
        #expect(player.hasFailed == false)
    }
}

private func rms(_ samples: some Collection<Float>) -> Float {
    (samples.reduce(0) { $0 + $1 * $1 } / Float(max(samples.count, 1))).squareRoot()
}

private func peak(_ samples: some Collection<Float>) -> Float {
    samples.reduce(0) { max($0, abs($1)) }
}

private func decibels(_ ratio: Float) -> Float {
    20 * log10(max(ratio, 1e-12))
}

/// Writes `seconds` of white noise, different in each channel, through a ``CaptureWriter``.
private func writeNoise(to url: URL, seconds: Double) throws {
    let writer = try CaptureWriter(url: url, bitrate: 128_000, channels: 2)
    var state: UInt32 = 1
    for _ in 0..<Int(seconds * 10) {
        let buffer = sineBuffer(seconds: 0.1, amplitude: 0)
        for channel in 0..<2 {
            let samples = buffer.floatChannelData![channel]
            for frame in 0..<Int(buffer.frameLength) {
                // Linear congruential generator, so the noise is the same on every run.
                state = state &* 1_664_525 &+ 1_013_904_223
                samples[frame] = (Float(state >> 8) / Float(1 << 24) - 0.5) * 0.6
            }
        }
        try writer.write(buffer)
    }
    writer.close()
}
