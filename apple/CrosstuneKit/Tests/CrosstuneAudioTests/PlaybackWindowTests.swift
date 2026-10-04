import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneAudio

private func recording(trimStartMs: Int64 = 0, trimEndMs: Int64? = nil, sourceDurationMs: Int64? = 4000) -> Recording {
    Recording(
        tuneID: nil, source: "captured", addedAt: noon, sourceDurationMs: sourceDurationMs,
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

@Suite struct LoopScheduleTests {
    /// Seconds 1 to 4 of a 4-second file at 1000 frames a second, looping 1 to 2 into it,
    /// which is frames 2000 to 3000.
    private let window = PlaybackWindow(from: 1, to: 4)
    private let loop = PlaybackWindow(from: 1, to: 2)
    private let theLoop = PlaybackSegment(startFrame: 2000, frameCount: 1000)

    private func next(_ position: TimeInterval, loop: PlaybackWindow?, repeating: Bool) -> [PlaybackSegment] {
        LoopSchedule.next(
            position: position, loop: loop, repeat: repeating, window: window, sampleRate: 1000, fileLength: 4000)
    }

    @Test func insideARepeatingLoopPlaysToItsEndThenTheLoopTwice() {
        #expect(
            next(1.5, loop: loop, repeating: true)
                == [PlaybackSegment(startFrame: 2500, frameCount: 500), theLoop, theLoop])
        #expect(next(1, loop: loop, repeating: true) == [theLoop, theLoop, theLoop])
    }

    @Test func beforeARepeatingLoopPlaysIntoItThenTheLoopTwice() {
        #expect(
            next(0.5, loop: loop, repeating: true)
                == [PlaybackSegment(startFrame: 1500, frameCount: 1500), theLoop, theLoop])
    }

    @Test func pastARepeatingLoopPlaysOnToTheWindowEnd() {
        #expect(next(2.5, loop: loop, repeating: true) == [PlaybackSegment(startFrame: 3500, frameCount: 500)])
        #expect(next(2, loop: loop, repeating: true) == [PlaybackSegment(startFrame: 3000, frameCount: 1000)])
    }

    @Test func repeatOffOrNoLoopPlaysToTheWindowEnd() {
        let toEnd = [PlaybackSegment(startFrame: 2500, frameCount: 1500)]
        #expect(next(1.5, loop: loop, repeating: false) == toEnd)
        #expect(next(1.5, loop: nil, repeating: true) == toEnd)
        #expect(next(3, loop: loop, repeating: false) == [])
    }

    @Test func aLoopIsHeldWithinTheWindowAndTheFile() {
        let short = LoopSchedule.next(
            position: 1.5, loop: PlaybackWindow(from: 1, to: 9), repeat: true, window: window, sampleRate: 1000,
            fileLength: 3500)
        let held = PlaybackSegment(startFrame: 2000, frameCount: 1500)
        #expect(short == [PlaybackSegment(startFrame: 2500, frameCount: 1000), held, held])
    }

    @Test func playStartsAtTheLoopStartOnlyWhenRepeatingFromOutsideIt() {
        #expect(LoopSchedule.entry(position: 0.5, loop: loop, repeat: true) == 1)
        #expect(LoopSchedule.entry(position: 2, loop: loop, repeat: true) == 1)
        #expect(LoopSchedule.entry(position: 1.5, loop: loop, repeat: true) == 1.5)
        #expect(LoopSchedule.entry(position: 0.5, loop: loop, repeat: false) == 0.5)
        #expect(LoopSchedule.entry(position: 0.5, loop: nil, repeat: true) == 0.5)
    }

    @Test func thePositionInARepeatingRunFoldsBackIntoTheLoop() {
        let run = ScheduledRun(start: 1.5, leadFrames: 500, loop: LoopRun(from: 1, frames: 1000))
        #expect(run.position(playedFrames: 250, sampleRate: 1000, duration: 3) == 1.75)
        #expect(run.position(playedFrames: 500, sampleRate: 1000, duration: 3) == 1)
        #expect(run.position(playedFrames: 1750, sampleRate: 1000, duration: 3) == 1.25)
        #expect(abs(run.position(playedFrames: 3499, sampleRate: 1000, duration: 3) - 1.999) < 1e-9)
        let plain = ScheduledRun(start: 0.5, leadFrames: 2500, loop: nil)
        #expect(plain.position(playedFrames: 500, sampleRate: 1000, duration: 2) == 1)
        #expect(plain.position(playedFrames: 9000, sampleRate: 1000, duration: 2) == 2)
    }
}
