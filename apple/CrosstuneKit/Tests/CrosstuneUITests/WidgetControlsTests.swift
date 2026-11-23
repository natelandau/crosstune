import CrosstuneAudio
import CrosstuneRecordingActivity
import CrosstuneShare
import CrosstuneTestSupport
import CrosstuneWidgetData
import Foundation
import Testing

@testable import CrosstuneUI

/// A widget button for a list playback or recording the app no longer holds, as after the app
/// was ended while suspended, clears that state from the summary so the widget stops showing it.
@MainActor
@Suite struct WidgetControlsTests {
    private let root = TemporaryRoot()
    private let suite = TemporaryDefaults("WidgetControlsTests")
    private let reloads = KindLog()

    private var container: ShareContainer { ShareContainer(root: root.url.appending(path: "group")) }

    private static let paused = WidgetListPlayback(
        listID: "l1", currentTuneID: "t1", isPlaying: false, position: 1, count: 2, nextTuneID: "t2")
    private static let interrupted = RecordingActivityState(
        status: .interrupted, timerStart: nil, elapsed: 4, canResume: true)

    enum Button: String, CaseIterable, Sendable {
        case pauseList, resumeList, resumeRecording
    }

    private func controls(_ listPlayback: ListPlayback) throws -> WidgetControls {
        try container.setCurrentUserID("user_a")
        let summary = WidgetSummary(
            recordingsPlay: true, recordings: [], lists: [], tunerReferenceLabel: nil,
            recording: Self.interrupted, recordingFreshUntil: nil, listPlayback: Self.paused)
        try WidgetSummaryFile.write(summary, userID: "user_a", in: container)
        let reloads = reloads
        let publisher = WidgetPublisher(
            container: container, pageStore: nil, reload: { reloads.kinds.append($0) })
        return WidgetControls(listPlayback: listPlayback, recorders: RecorderHost(), publisher: publisher)
    }

    private func listPlayback() -> ListPlayback {
        ListPlayback(player: PlayerModel(), commands: SilentTrackCommands(), defaults: suite.defaults)
    }

    private static func press(_ button: Button, on controls: WidgetControls) async {
        switch button {
        case .pauseList: await controls.pauseList()
        case .resumeList: await controls.resumeList()
        case .resumeRecording: await controls.resume()
        }
    }

    @Test(arguments: Button.allCases)
    func aButtonWithNothingBehindItClearsWhatItShows(button: Button) async throws {
        let controls = try controls(listPlayback())

        await Self.press(button, on: controls)

        let summary = try #require(WidgetSummaryFile.read(userID: "user_a", in: container))
        let clearsRecording = button == .resumeRecording
        #expect(summary.listPlayback == (clearsRecording ? Self.paused : nil))
        #expect(summary.recording == (clearsRecording ? nil : Self.interrupted))
        #expect(reloads.kinds == [clearsRecording ? [.recordings] : [.list]])
    }

    /// While the app is suspended with the list still held, the button acts on the list and the
    /// summary stays as the publisher wrote it.
    @Test(arguments: [Button.pauseList, .resumeList])
    func aListButtonLeavesTheSummaryWhileTheListIsHeld(button: Button) async throws {
        let playback = listPlayback()
        let controls = try controls(playback)
        playback.start(listID: "l1", name: "Session", tuneIDs: ["t1", "t2"], shuffled: false)

        await Self.press(button, on: controls)

        #expect(WidgetSummaryFile.read(userID: "user_a", in: container)?.listPlayback == Self.paused)
        #expect(reloads.kinds.isEmpty)
    }
}

@MainActor
private final class KindLog {
    var kinds: [Set<WidgetKind>] = []
}

private final class SilentTrackCommands: TrackCommands {
    func enable(next: @escaping @MainActor () -> Void, previous: @escaping @MainActor () -> Void) {}
    func disable() {}
}
