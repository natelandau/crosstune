import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneWidgetIntents
import GRDB
import SwiftUI
import os

/// What a shell does for a widget tap once the app is open.
@MainActor
protocol WidgetShellActions {
    func startRecording(source: ActionSource)
    func openRecordingPage(id: String, source: ActionSource)
    func playRecording(id: String, source: ActionSource)
    /// Plays list `id` as Play and Shuffle on the Lists screen do, from tune `fromTune` when the
    /// list holds it, else from the top. `recordingsPlay` is the plan the request was judged by,
    /// which the plan model can lag behind right after launch.
    func playList(id: String, shuffled: Bool, fromTune: String?, recordingsPlay: Bool)
    func openList(id: String)
    func showTuner()
    func showPlan()
}

/// Turns a widget request into the shell action it asks for.
@MainActor
enum WidgetRequestRouter {
    static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "widget-requests")

    /// Takes the request waiting in `inbox` once the plan has loaded, so a tap that launches the app
    /// is judged by the account's plan rather than by the unknown plan before its first read. Only
    /// an active scene takes it, since every window's shell watches the one inbox and a request
    /// run in a window behind another would show the musician nothing.
    static func takeRequest(from inbox: WidgetRequestInbox, planLoaded: Bool, sceneActive: Bool) -> WidgetRequest? {
        guard planLoaded, sceneActive else { return nil }
        return inbox.take()
    }

    /// Call it with each request the shell takes from the inbox. A recording request on a plan
    /// whose recordings do not play shows the plans instead, as every Recordings widget tap does
    /// on that plan. A list request runs on every plan, since the list's own playability rules
    /// decide what plays.
    static func route(_ request: WidgetRequest, recordingsPlay: Bool, to shell: any WidgetShellActions) {
        switch request {
        case .record:
            if recordingsPlay { shell.startRecording(source: .widget) } else { shell.showPlan() }
        case .playRecording(let id):
            guard recordingsPlay else {
                shell.showPlan()
                return
            }
            shell.openRecordingPage(id: id, source: .widget)
            shell.playRecording(id: id, source: .widget)
        case .playList(let id, let shuffled):
            shell.playList(id: id, shuffled: shuffled, fromTune: nil, recordingsPlay: recordingsPlay)
        case .playListFromTune(let id, let tuneID):
            shell.playList(id: id, shuffled: false, fromTune: tuneID, recordingsPlay: recordingsPlay)
        case .openList(let id):
            shell.openList(id: id)
        case .openTuner:
            shell.showTuner()
        case .openPlan:
            shell.showPlan()
        case .openApp:
            break
        }
    }
}

/// Runs `run` each time a widget request arrives, the plan finishes its first read, or the scene
/// becomes active. A tap can launch the app before the shell exists, its plan has read, or its
/// scene is active, so a request waiting from then runs once all are there.
struct WidgetRequestWatch: ViewModifier {
    let planLoaded: Bool?
    let sceneActive: Bool
    let run: @MainActor () -> Void

    func body(content: Content) -> some View {
        content
            .onChange(of: WidgetRequestInbox.shared.pending, initial: true) { run() }
            .onChange(of: planLoaded) { run() }
            .onChange(of: sceneActive) { run() }
    }
}

extension PlayerItem {
    /// Recording `id` as the player loads it, or nil when it is gone.
    nonisolated static func fetchRecording(_ db: Database, id: String) throws -> PlayerItem? {
        guard let recording = try Recording.fetchOne(db, key: id), recording.deletedAt == nil else { return nil }
        let tuneTitle = try recording.tuneID.flatMap { try Tune.fetchOne(db, key: $0) }.map(\.title)
        return .recording(recording, tuneTitle: tuneTitle)
    }
}
