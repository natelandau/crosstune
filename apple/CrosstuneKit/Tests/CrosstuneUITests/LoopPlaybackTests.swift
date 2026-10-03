import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private func loop(_ id: String, _ startMs: Int64, _ endMs: Int64, deleted: Bool = false) -> RecordingLoop {
    RecordingLoop(
        id: id, createdAt: noon, updatedAt: noon, deletedAt: deleted ? noon : nil, recordingID: "r1", label: nil,
        startMs: startMs, endMs: endMs, color: 0)
}

@MainActor
@Suite struct LoopPlaybackTests {
    private let audio = FakeAudio()
    private let loops: LoopPlayback

    init() {
        loops = LoopPlayback(audio: audio)
        loops.audioReady(trimStartMs: 0)
        loops.follow([loop("a", 5000, 15_000), loop("b", 20_000, 25_000)])
    }

    @Test func selectingALoopRepeatsItAndMovesAnOutsidePlayheadToItsStart() {
        audio.elapsed = 1
        loops.select("a")
        #expect(loops.selectedID == "a")
        #expect(loops.isRepeating)
        #expect(audio.isRepeating)
        #expect(audio.loop == PlaybackWindow(from: 5, to: 15))
        #expect(audio.elapsed == 5)
    }

    @Test func aPlayheadInsideTheLoopStaysPut() {
        audio.elapsed = 9
        loops.select("a")
        #expect(audio.elapsed == 9)
        #expect(audio.isRepeating)
    }

    @Test func theLoopsEndIsOutsideIt() {
        audio.elapsed = 15
        loops.select("a")
        #expect(audio.elapsed == 5)
    }

    @Test func switchingLoopsKeepsRepeatAndMovesToTheNewStart() {
        loops.select("a")
        audio.elapsed = 9
        loops.select("b")
        #expect(loops.isRepeating)
        #expect(audio.loop == PlaybackWindow(from: 20, to: 25))
        #expect(audio.elapsed == 20)
    }

    @Test func deselectingPlaysOn() {
        loops.select("a")
        audio.elapsed = 9
        loops.select(nil)
        #expect(loops.selectedID == nil)
        #expect(!loops.isRepeating)
        #expect(!audio.isRepeating)
        #expect(audio.loop == nil)
        #expect(audio.elapsed == 9)
    }

    @Test func aTombstonedSelectedLoopClearsTheSelectionAndRepeat() {
        loops.select("a")
        audio.elapsed = 9
        loops.follow([loop("a", 5000, 15_000, deleted: true), loop("b", 20_000, 25_000)])
        #expect(loops.selectedID == nil)
        #expect(!loops.isRepeating)
        #expect(!audio.isRepeating)
        #expect(audio.loop == nil)
        #expect(audio.elapsed == 9)
    }

    @Test func aLoopJustMadeIsSelectedAndRepeats() {
        audio.elapsed = 1
        loops.select(loop("n", 30_000, 34_000))
        #expect(loops.selectedID == "n")
        #expect(audio.isRepeating)
        #expect(audio.elapsed == 30)
    }
}
