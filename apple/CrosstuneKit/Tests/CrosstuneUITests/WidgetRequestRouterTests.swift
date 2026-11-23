import CrosstuneAnalytics
import CrosstuneWidgetIntents
import Testing

@testable import CrosstuneUI

/// A widget tap reaches the shell action it asks for, and a recording tap without Premium shows
/// the plans instead.
@MainActor
@Suite struct WidgetRequestRouterTests {
    enum Call: Equatable {
        case startRecording(ActionSource)
        case openRecordingPage(id: String, source: ActionSource)
        case playRecording(id: String, source: ActionSource)
        case playList(id: String, shuffled: Bool, fromTune: String?, recordingsPlay: Bool)
        case openList(id: String)
        case showTuner
        case showPlan
    }

    @MainActor final class ShellLog: WidgetShellActions {
        var calls: [Call] = []

        func startRecording(source: ActionSource) { calls.append(.startRecording(source)) }
        func openRecordingPage(id: String, source: ActionSource) {
            calls.append(.openRecordingPage(id: id, source: source))
        }
        func playRecording(id: String, source: ActionSource) { calls.append(.playRecording(id: id, source: source)) }
        func playList(id: String, shuffled: Bool, fromTune: String?, recordingsPlay: Bool) {
            calls.append(.playList(id: id, shuffled: shuffled, fromTune: fromTune, recordingsPlay: recordingsPlay))
        }
        func openList(id: String) { calls.append(.openList(id: id)) }
        func showTuner() { calls.append(.showTuner) }
        func showPlan() { calls.append(.showPlan) }
    }

    private static func routed(_ request: WidgetRequest, recordingsPlay: Bool) -> [Call] {
        let shell = ShellLog()
        WidgetRequestRouter.route(request, recordingsPlay: recordingsPlay, to: shell)
        return shell.calls
    }

    @Test(
        arguments: [
            (WidgetRequest.record, [Call.startRecording(.widget)]),
            (
                .playRecording(id: "rec_1"),
                [.openRecordingPage(id: "rec_1", source: .widget), .playRecording(id: "rec_1", source: .widget)]
            ),
            (
                .playList(id: "list_1", shuffled: false),
                [.playList(id: "list_1", shuffled: false, fromTune: nil, recordingsPlay: true)]
            ),
            (
                .playList(id: "list_1", shuffled: true),
                [.playList(id: "list_1", shuffled: true, fromTune: nil, recordingsPlay: true)]
            ),
            (
                .playListFromTune(id: "list_1", tuneID: "tune_2"),
                [.playList(id: "list_1", shuffled: false, fromTune: "tune_2", recordingsPlay: true)]
            ),
            (.openList(id: "list_1"), [.openList(id: "list_1")]),
            (.openTuner, [.showTuner]),
            (.openPlan, [.showPlan]),
            (.openApp, []),
        ] as [(WidgetRequest, [Call])])
    func eachRequestRunsItsShellAction(request: WidgetRequest, expected: [Call]) {
        #expect(Self.routed(request, recordingsPlay: true) == expected)
    }

    @Test(arguments: [WidgetRequest.record, .playRecording(id: "rec_1")])
    func recordingRequestsOpenThePlanWithoutPremium(request: WidgetRequest) {
        #expect(Self.routed(request, recordingsPlay: false) == [.showPlan])
    }

    /// Every window's shell watches the one inbox, so only the window in front takes a request.
    @Test func aRequestWaitsForTheLoadedPlanAndTheWindowInFront() {
        let inbox = WidgetRequestInbox()
        inbox.post(.record)
        #expect(WidgetRequestRouter.takeRequest(from: inbox, planLoaded: false, sceneActive: true) == nil)
        #expect(WidgetRequestRouter.takeRequest(from: inbox, planLoaded: true, sceneActive: false) == nil)
        #expect(WidgetRequestRouter.takeRequest(from: inbox, planLoaded: true, sceneActive: true) == .record)
        #expect(inbox.pending == nil)
    }

    /// The app's playability rules decide what a list plays on a plan without recordings, judged
    /// by the plan the router was given rather than one still catching up.
    @Test func aListPlaysWithoutPremium() {
        #expect(
            Self.routed(.playList(id: "list_1", shuffled: false), recordingsPlay: false) == [
                .playList(id: "list_1", shuffled: false, fromTune: nil, recordingsPlay: false)
            ])
    }
}
