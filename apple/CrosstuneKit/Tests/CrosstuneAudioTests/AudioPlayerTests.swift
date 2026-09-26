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
