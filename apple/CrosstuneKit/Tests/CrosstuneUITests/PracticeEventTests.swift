import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneUI

private func recording(_ id: String = "r1", isMono: Bool? = nil) -> Recording {
    Recording(
        id: id, tuneID: nil, source: "microphone", addedAt: noon, label: "Jam", state: "ready",
        sourceDurationMs: 60_000, trimStartMs: 0, speedPercent: 100, pitchCents: 0, isMono: isMono)
}

/// The recording screen reports a loop once it repeats, a speed, pitch, or isolate setting once
/// its panel closes changed, and a trim once it is saved.
@MainActor
@Suite(.timeLimit(.minutes(1))) struct PracticeEventTests {
    private let sink = RecordingAnalyticsSink()
    private let audio = FakeAudio()
    private let player: PlayerModel

    init() {
        player = PlayerModel(audio: audio, analytics: sink.client)
        audio.duration = 60
        player.audioSource = { id in
            RecordingAudioFile(
                url: URL(filePath: "/tmp/\(id).m4a"), file: RecordingFile(id: id, localState: .downloaded))
        }
    }

    private var writer: LoopWriter {
        let player = player
        return LoopWriter(
            add: { recordingID, span in
                let row = RecordingLoop(
                    id: "n\(span.startMs)", createdAt: noon, updatedAt: noon, recordingID: recordingID, label: nil,
                    startMs: span.startMs, endMs: span.endMs, color: 0)
                player.loopsChanged(id: recordingID, to: [row])
                return row
            },
            update: { _, _, _ in }, remove: { _ in })
    }

    /// The recording loaded paused on its screen.
    private func opened(isMono: Bool? = nil, sourceLocation: SourceLocation = #_sourceLocation) async throws
        -> PracticeModel
    {
        let row = recording(isMono: isMono)
        player.loadPaused(.recording(row, tuneTitle: nil))
        RecordingPageOpener.shell(ShellPlace(), player: player)(row.id, source: .recordingsList)
        try await eventually(sourceLocation: sourceLocation) { player.recordingAudio == .loaded }
        let model = PracticeModel(player: player, recording: row, file: nil, writer: writer, announce: { _ in })
        model.openVisit()
        model.showPanel()
        return model
    }

    private func captures(named name: String) -> [RecordingAnalyticsSink.Capture] {
        sink.captures.filter { $0.name == name }
    }

    @Test func reportsNoPitchMovedWithinItsSemitone() async throws {
        let model = try await opened()
        model.mode = .pitch
        player.setPitch(30)

        model.leave()

        #expect(captures(named: "pitch_changed").isEmpty)
    }

    @Test func reportsOneSpeedAsThePanelClosesOnIt() async throws {
        let model = try await opened()
        model.mode = .speed
        for percent in [95, 90, 85, 75, 80] { player.setSpeed(percent) }
        #expect(captures(named: "speed_changed").isEmpty)

        model.mode = .loops

        #expect(
            captures(named: "speed_changed") == [
                .init(
                    name: "speed_changed",
                    properties: ["speed_bucket": .string("0.75-0.99"), "recording_id": .string("r1")])
            ])
    }

    /// Where a mode's controls open in a popover, closing it reports the setting, once.
    @Test func reportsOneSpeedAsThePopoverCloses() async throws {
        let model = try await opened()
        model.mode = .speed
        player.setSpeed(80)

        model.modeControlsShown(false)
        #expect(captures(named: "speed_changed").count == 1)

        model.modeControlsShown(true)
        model.leave()
        #expect(captures(named: "speed_changed").count == 1)
    }

    @Test func reportsNoSpeedPutBackWhereItWas() async throws {
        let model = try await opened()
        model.mode = .speed
        player.setSpeed(80)
        player.setSpeed(100)

        model.mode = .pitch

        #expect(captures(named: "speed_changed").isEmpty)
    }

    @Test func reportsAPitchInSemitonesAsTheScreenGoes() async throws {
        let model = try await opened()
        model.mode = .pitch
        player.setPitch(100)
        player.setPitch(300)

        model.leave()

        #expect(
            captures(named: "pitch_changed") == [
                .init(name: "pitch_changed", properties: ["semitones": .int(3), "recording_id": .string("r1")])
            ])
    }

    @Test func closingTheIsolatePanelAfterAChangeSendsIsolateChangedWithBucketsOnly() async throws {
        let model = try await opened()
        model.mode = .isolate
        player.setIsolate(IsolateSetting(effect: .solo, panStart: -60, panEnd: 20, lowHz: 40, highHz: 16000))
        player.setIsolate(IsolateSetting(effect: .mute, panStart: -100, panEnd: 100, lowHz: 200, highHz: 4000))

        model.mode = .loops

        #expect(
            captures(named: "isolate_changed") == [
                .init(
                    name: "isolate_changed",
                    properties: [
                        "effect": .string("mute"), "uses_stereo": .bool(false), "uses_frequency": .bool(true),
                        "recording_id": .string("r1"),
                    ])
            ])
    }

    @Test func reportsNoStereoRangeOnAMonoRecording() async throws {
        let model = try await opened(isMono: true)
        model.mode = .isolate
        player.setIsolate(IsolateSetting(effect: .mute, panStart: -60, panEnd: 20, lowHz: 200, highHz: 4000))

        model.mode = .loops

        #expect(
            captures(named: "isolate_changed") == [
                .init(
                    name: "isolate_changed",
                    properties: [
                        "effect": .string("mute"), "uses_stereo": .bool(false), "uses_frequency": .bool(true),
                        "recording_id": .string("r1"),
                    ])
            ])
    }

    @Test func reportsNoIsolatePutBackWhereItWas() async throws {
        let model = try await opened()
        model.mode = .isolate
        let openedOn = player.isolate
        player.setIsolate(IsolateSetting(effect: .mute, panStart: -100, panEnd: 0, lowHz: 40, highHz: 16000))
        player.setIsolate(openedOn)

        model.mode = .loops

        #expect(captures(named: "isolate_changed").isEmpty)
    }

    @Test func reportsOneIsolateChangeAsTheIsolatePanelCloses() async throws {
        let model = try await opened()
        model.mode = .isolate
        player.setIsolate(IsolateSetting(effect: .solo, panStart: -60, panEnd: 20, lowHz: 40, highHz: 16000))
        player.setIsolate(IsolateSetting(effect: .mute, panStart: -60, panEnd: 20, lowHz: 40, highHz: 16000))
        #expect(captures(named: "isolate_changed").isEmpty)

        model.mode = .loops

        #expect(captures(named: "isolate_changed").count == 1)
        #expect(captures(named: "isolate_changed").first?.properties["effect"] == .string("mute"))
    }

    @Test func reportsNoIsolateWhenTheIsolatePanelClosesUnchanged() async throws {
        let model = try await opened()
        model.mode = .isolate

        model.leave()

        #expect(captures(named: "isolate_changed").isEmpty)
    }

    /// The screen on the next recording, which shows before the last one's has gone.
    private func switched(to id: String, mode: PracticeMode, sourceLocation: SourceLocation = #_sourceLocation)
        async throws -> PracticeModel
    {
        player.loadPaused(.recording(recording(id), tuneTitle: nil))
        RecordingPageOpener.shell(ShellPlace(), player: player)(id, source: .recordingsList)
        try await eventually(sourceLocation: sourceLocation) {
            player.recordingAudio == .loaded && player.holds(.recording, id: id)
        }
        let model = PracticeModel(
            player: player, recording: recording(id), file: nil, writer: writer, mode: mode, announce: { _ in })
        model.openVisit()
        model.showPanel()
        return model
    }

    @Test func aScreenLeftAfterTheNextOneShowsReportsItsOwnRecordingsIsolate() async throws {
        let first = try await opened()
        first.mode = .isolate
        player.setIsolate(IsolateSetting(effect: .mute, panStart: -60, panEnd: 20, lowHz: 40, highHz: 16000))

        let next = try await switched(to: "r2", mode: .isolate)
        first.leave()

        #expect(
            captures(named: "isolate_changed") == [
                .init(
                    name: "isolate_changed",
                    properties: [
                        "effect": .string("mute"), "uses_stereo": .bool(true), "uses_frequency": .bool(false),
                        "recording_id": .string("r1"),
                    ])
            ])
        next.leave()
        #expect(captures(named: "isolate_changed").count == 1)
    }

    @Test func aScreenLeftAfterTheNextOneShowsReportsItsOwnRecordingsSpeed() async throws {
        let first = try await opened()
        first.mode = .speed
        player.setSpeed(80)

        let next = try await switched(to: "r2", mode: .speed)
        first.leave()
        next.leave()

        #expect(
            captures(named: "speed_changed") == [
                .init(
                    name: "speed_changed",
                    properties: ["speed_bucket": .string("0.75-0.99"), "recording_id": .string("r1")])
            ])
    }

    @Test func reportsALoopSetToRepeat() async throws {
        let model = try await opened()

        model.newLoop()
        await model.settle()
        let made = try #require(player.loops.selectedID)
        model.select(nil)
        model.select(made)

        #expect(captures(named: "loop_set").count == 2)
    }

    @Test func reportsATrimOnceItIsSaved() async throws {
        let trim = TrimModel(
            recording: recording(), file: nil, write: { _, _, _ in }, hold: { _ in }, analytics: sink.client)
        trim.drag(.start, to: 5_000)

        #expect(try await trim.save())

        #expect(sink.captures == [.init(name: "recording_trimmed", properties: ["recording_id": .string("r1")])])
    }

    @Test func reportsNoTrimThatFailedToSave() async throws {
        struct Refused: Error {}
        let trim = TrimModel(
            recording: recording(), file: nil, write: { _, _, _ in throw Refused() }, hold: { _ in },
            analytics: sink.client)
        trim.drag(.start, to: 5_000)

        _ = try? await trim.save()

        #expect(sink.calls.isEmpty)
    }
}
