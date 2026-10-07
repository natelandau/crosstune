import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// The record sheet reports a take once the microphone is capturing, and how it ended with its
/// length in a bucket. A take that never captured reports nothing.
@MainActor
@Suite struct RecordingEventTests {
    private let root = TemporaryRoot()
    private let input = ToneInput()
    private let sink = RecordingAnalyticsSink()
    private let recorder: Recorder

    init() throws {
        recorder = Recorder(store: try root.open(), input: input, channels: { .mono })
    }

    private func sheet(source: ActionSource = .dock) -> RecordSheetModel {
        RecordSheetModel(recorder: recorder, tuneID: nil, source: source, analytics: sink.client)
    }

    @Test func reportsATakeStartedAndSavedWithItsLength() async throws {
        let model = sheet(source: .menu)
        await model.begin()
        #expect(sink.captures == [.init(name: "recording_started", properties: ["source": .string("menu")])])

        try input.play(seconds: 45)
        await model.stop()

        #expect(
            sink.captures == [
                .init(name: "recording_started", properties: ["source": .string("menu")]),
                .init(name: "recording_saved", properties: ["duration_bucket": .string("30s-2m")]),
            ])
    }

    @Test func reportsATakeDiscardedAfterItCaptured() async throws {
        let model = sheet()
        await model.begin()
        try input.play(seconds: 5)

        await model.cancel()
        await model.discard()

        #expect(
            sink.captures == [
                .init(name: "recording_started", properties: ["source": .string("dock")]),
                .init(name: "recording_discarded", properties: ["duration_bucket": .string("<30s")]),
            ])
    }

    @Test func cancellingTheSheetBeforeItCapturesRecordsNothing() async throws {
        let model = sheet()
        let begin = Task { await model.begin() }
        #expect(try await poll { recorder.isStarting })

        await model.cancel()
        await begin.value

        #expect(model.outcome == .dropped)
        #expect(sink.calls.isEmpty)
    }

    @Test func reportsNothingWhenTheMicrophoneIsRefused() async throws {
        input.permission = false
        let model = sheet()
        await model.begin()
        await model.cancel()
        model.finish()

        #expect(sink.calls.isEmpty)
    }

    @Test func reportsASaveWithSomethingToSayOnce() async throws {
        let model = sheet()
        await model.begin()
        try input.play(seconds: 0.5)
        input.send(.writeFailed)
        #expect(try await poll { model.phase == .saved })

        model.settle()
        model.finish()

        #expect(sink.captures.map(\.name) == ["recording_started", "recording_saved"])
    }

    @Test func reportsATakeKeptWhenItsSheetIsAbandoned() async throws {
        let model = sheet()
        await model.begin()
        try input.play(seconds: 0.5)

        await model.abandon()

        #expect(sink.captures.map(\.name) == ["recording_started", "recording_saved"])
    }
}
