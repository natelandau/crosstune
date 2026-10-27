import CrosstuneAudio
import CrosstuneRecording
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

private func recording(trimStartMs: Int64 = 0, trimEndMs: Int64? = nil, sourceDurationMs: Int64? = 4000) -> Recording {
    Recording(
        tuneID: nil, source: "captured", addedAt: noon, sourceDurationMs: sourceDurationMs,
        trimStartMs: trimStartMs, trimEndMs: trimEndMs)
}

private func file(blobStartMs: Int64 = 0) -> RecordingFile {
    RecordingFile(id: "r1", localState: .downloaded, blobStartMs: blobStartMs)
}

@Suite struct PlaybackWindowRecordingTests {
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
}
