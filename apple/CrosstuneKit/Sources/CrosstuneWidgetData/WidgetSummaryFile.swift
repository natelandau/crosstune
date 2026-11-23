import CrosstuneShare
import Foundation

/// The summary file in the App Group, one per user. It lives in the user's folder, so removing
/// the user removes it.
public enum WidgetSummaryFile {
    private static let fileName = "widgets.json"

    /// Call it whenever the app's data changes, so the widgets read current values.
    public static func write(_ summary: WidgetSummary, userID: String, in container: ShareContainer) throws {
        try ShareFile.writeJSON(summary, named: fileName, userID: userID, in: container)
    }

    /// The written summary, or nil when there is none.
    public static func read(userID: String, in container: ShareContainer) -> WidgetSummary? {
        ShareFile.readJSON(WidgetSummary.self, named: fileName, userID: userID, in: container)
    }

    /// The signed-in user's summary, told apart from no one signed in, so a widget never asks a
    /// signed-in musician to sign in.
    public static func readCurrent(in container: ShareContainer) -> CurrentWidgetSummary {
        guard let userID = container.currentUserID() else { return .signedOut }
        return read(userID: userID, in: container).map(CurrentWidgetSummary.available) ?? .unavailable
    }

    /// The signed-in user's summary in the App Group, for a widget that cannot name the
    /// container. Signed out also when the App Group is unavailable, since no one can sign in
    /// to a build without it.
    public static func readCurrent() -> CurrentWidgetSummary {
        ShareContainer.appGroup().map(readCurrent(in:)) ?? .signedOut
    }
}
