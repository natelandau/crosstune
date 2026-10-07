import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private func take() -> Recording {
    Recording(
        id: "r1", tuneID: nil, source: "microphone", addedAt: noon, label: "Jam", state: "ready",
        sourceDurationMs: 60_000, trimStartMs: 0, speedPercent: 100, pitchCents: 0)
}

/// The recording screen reports a practice visit as it opens, a loop once it repeats, a speed or
/// pitch once its panel closes changed, and a trim once it is saved.
@MainActor
@Suite struct PracticeEventTests {
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

    /// The recording loaded paused on its screen, opened from `source`.
    private func opened(from source: ActionSource = .recordingsList) async throws -> PracticeModel {
        player.open(.recording(take(), tuneTitle: nil), playing: false, source: source)
        #expect(try await poll { player.recordingAudio == .loaded })
        let model = PracticeModel(player: player, recording: take(), file: nil, writer: writer, announce: { _ in })
        model.enter()
        return model
    }

    private func captures(named name: String) -> [RecordingAnalyticsSink.Capture] {
        sink.captures.filter { $0.name == name }
    }

    @Test func reportsAVisitOnceWithWhereTheScreenWasOpened() async throws {
        let model = try await opened(from: .recordingsList)
        model.leave()
        model.enter()

        #expect(sink.captures == [.init(name: "practice_started", properties: ["source": .string("recordings_list")])])
    }

    @Test func reportsAVisitOpenedFromTheDock() async throws {
        player.play(.recording(take(), tuneTitle: nil))
        #expect(try await poll { player.recordingAudio == .loaded })
        player.expand(source: .dock)
        let model = PracticeModel(player: player, recording: take(), file: nil, writer: writer, announce: { _ in })

        model.enter()

        #expect(
            captures(named: "practice_started") == [
                .init(name: "practice_started", properties: ["source": .string("dock")])
            ])
    }

    @Test func aLaterVisitWithNoWayInNamedReportsTheDock() async throws {
        let model = try await opened(from: .recordingsList)
        model.leave()
        player.screenClosed()

        // A visit begun without asking, as a playlist moving on under an open screen.
        player.screenOpened("r2")

        #expect(
            sink.captures.filter { $0.name == "practice_started" } == [
                .init(name: "practice_started", properties: ["source": .string("recordings_list")]),
                .init(name: "practice_started", properties: ["source": .string("dock")]),
            ])
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
                .init(name: "speed_changed", properties: ["speed_bucket": .string("0.75-0.99")])
            ])
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

        #expect(captures(named: "pitch_changed") == [.init(name: "pitch_changed", properties: ["semitones": .int(3)])])
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
            recording: take(), file: nil, write: { _, _, _ in }, hold: { _ in }, analytics: sink.client)
        trim.drag(.start, to: 5_000)

        #expect(try await trim.save())

        #expect(sink.captures == [.init(name: "recording_trimmed", properties: [:])])
    }

    @Test func reportsNoTrimThatFailedToSave() async throws {
        struct Refused: Error {}
        let trim = TrimModel(
            recording: take(), file: nil, write: { _, _, _ in throw Refused() }, hold: { _ in }, analytics: sink.client)
        trim.drag(.start, to: 5_000)

        _ = try? await trim.save()

        #expect(sink.calls.isEmpty)
    }
}
