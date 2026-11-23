import Observation

/// What a widget tap asks the app to do once it is open.
public enum WidgetRequest: Equatable, Sendable {
    case record
    case playRecording(id: String)
    case playList(id: String, shuffled: Bool)
    case playListFromTune(id: String, tuneID: String)
    case openList(id: String)
    case openTuner
    case openPlan
    case openApp
}

/// Holds the latest widget request until the app's shell can carry it out. A tap can launch the
/// app before its store opens, so the request waits here rather than running at once.
@MainActor
@Observable
public final class WidgetRequestInbox {
    /// Nonisolated so an intent's default value can name it from any context.
    public nonisolated static let shared = WidgetRequestInbox()

    /// The request not yet taken. Observe it to act when one arrives.
    public private(set) var pending: WidgetRequest?
    /// Whether a store has opened in this process, after which a change of user drops a request.
    @ObservationIgnored private var hasOpenedStore = false

    public nonisolated init() {}

    /// Leave a request for the shell. It replaces one not yet taken, because only the latest
    /// tap reflects what the musician wants.
    public func post(_ request: WidgetRequest) {
        pending = request
    }

    /// Call it when the shell is ready to act, so each request runs once.
    public func take() -> WidgetRequest? {
        defer { pending = nil }
        return pending
    }

    /// Call it each time the open store's user changes. A tap can launch the app before the
    /// process's first store opens, so that store keeps the request. Any later change, such as
    /// sign-out, a sign-in after it, or an account switch, drops it, so it never runs in
    /// another session.
    public func userChanged(from oldUserID: String?, to newUserID: String?) {
        let isFirstStore = newUserID != nil && !hasOpenedStore
        if newUserID != nil { hasOpenedStore = true }
        guard !isFirstStore, oldUserID != newUserID else { return }
        pending = nil
    }
}

/// The list playback actions a widget runs without opening the app. The app registers its list
/// player with `AppDependencyManager` before the first scene.
@MainActor
public protocol WidgetPlaybackControl: AnyObject, Sendable {
    func pauseList() async
    func resumeList() async
}
