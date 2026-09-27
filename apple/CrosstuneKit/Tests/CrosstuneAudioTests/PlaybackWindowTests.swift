import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneAudio

private func recording(trimStartMs: Int64 = 0, trimEndMs: Int64? = nil, sourceDurationMs: Int64? = 4000) -> Recording {
    Recording(
        tuneID: nil, source: "captured", recordedAt: noon, sourceDurationMs: sourceDurationMs,
        trimStartMs: trimStartMs, trimEndMs: trimEndMs)
}

private func file(blobStartMs: Int64 = 0) -> RecordingFile {
    RecordingFile(id: "r1", localState: .downloaded, blobStartMs: blobStartMs)
}

@Suite struct PlaybackWindowTests {
    @Test func aCapturedFileOffsetsTheTrimFromItsOwnStart() {
        let window = PlaybackWindow.make(
            recording: recording(trimStartMs: 1000, trimEndMs: 3000), file: file(), fileDuration: 4)
        #expect(window == PlaybackWindow(from: 1, to: 3))
        #expect(window.length == 2)
    }

    @Test func aCurrentDownloadAlreadyCutToTheTrimPlaysWhole() {
        let window = PlaybackWindow.make(
            recording: recording(trimStartMs: 1000, trimEndMs: 3000), file: file(blobStartMs: 1000),
            fileDuration: 2)
        #expect(window == PlaybackWindow(from: 0, to: 2))
    }

    @Test func aStaleDownloadCutToAnEarlierTrimPlaysTheNewTrimWithinIt() {
        let window = PlaybackWindow.make(
            recording: recording(trimStartMs: 1000, trimEndMs: 3000), file: file(blobStartMs: 500),
            fileDuration: 3)
        #expect(window == PlaybackWindow(from: 0.5, to: 2.5))
    }

    @Test func noTrimEndPlaysToTheSourceEndHeldWithinTheFile() {
        let toSource = PlaybackWindow.make(recording: recording(trimStartMs: 1000), file: file(), fileDuration: 4)
        #expect(toSource == PlaybackWindow(from: 1, to: 4))
        let toFile = PlaybackWindow.make(
            recording: recording(trimStartMs: 1000, sourceDurationMs: nil), file: file(), fileDuration: 3.5)
        #expect(toFile == PlaybackWindow(from: 1, to: 3.5))
        let pastFile = PlaybackWindow.make(
            recording: recording(trimStartMs: 1000, trimEndMs: 9000), file: file(), fileDuration: 4)
        #expect(pastFile == PlaybackWindow(from: 1, to: 4))
    }

    @Test func neverEndsBeforeItStarts() {
        #expect(PlaybackWindow(from: 3, to: 1) == PlaybackWindow(from: 3, to: 3))
        #expect(PlaybackWindow(from: -1, to: 2) == PlaybackWindow(from: 0, to: 2))
        #expect(PlaybackWindow(from: 1, to: 9).clamped(to: 4) == PlaybackWindow(from: 1, to: 4))
    }

    @Test func schedulesFromThePositionToTheWindowEnd() {
        let window = PlaybackWindow(from: 1, to: 3)
        #expect(
            window.segment(at: 0, sampleRate: 1000, fileLength: 4000)
                == PlaybackSegment(startFrame: 1000, frameCount: 2000))
        #expect(
            window.segment(at: 0.5, sampleRate: 1000, fileLength: 4000)
                == PlaybackSegment(startFrame: 1500, frameCount: 1500))
        #expect(
            window.segment(at: 0, sampleRate: 1000, fileLength: 2500)
                == PlaybackSegment(startFrame: 1000, frameCount: 1500))
        #expect(window.segment(at: 2, sampleRate: 1000, fileLength: 4000) == nil)
        #expect(window.segment(at: 5, sampleRate: 1000, fileLength: 4000) == nil)
    }

    @Test func thePositionIsTheSegmentStartPlusWhatThePlayerPlayed() {
        #expect(playbackPosition(segmentStart: 0.5, playedFrames: 500, sampleRate: 1000, duration: 2) == 1)
        #expect(playbackPosition(segmentStart: 1.5, playedFrames: 900, sampleRate: 1000, duration: 2) == 2)
        #expect(playbackPosition(segmentStart: 0.5, playedFrames: -10, sampleRate: 1000, duration: 2) == 0.5)
    }
}
