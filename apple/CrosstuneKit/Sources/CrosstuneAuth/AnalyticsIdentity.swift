import CrosstuneAnalytics
import Foundation

/// Keeps PostHog's person in step with the signed-in user. PostHog keeps an identified person
/// until it is reset and ignores an identify for anyone else, so a different user always
/// follows a reset.
@MainActor
struct AnalyticsIdentity {
    private let analytics: AnalyticsClient
    /// A user Clerk let go of without the app leaving, whose account deletion the API may still
    /// report.
    private var userLetGo: String?

    init(analytics: AnalyticsClient = .noop) {
        self.analytics = analytics
    }

    /// Call when Clerk's user changes, with the user remembered before the change. `isLeaving`
    /// holds the reset back for leaving, which sends its event first.
    mutating func userChanged(to userID: String?, from rememberedUserID: String?, isLeaving: Bool, signedUpAt: Date?) {
        guard let userID else {
            // Clerk let go of the user without the app's sign-out, such as an expired session.
            if let rememberedUserID, !isLeaving {
                analytics.reset()
                userLetGo = rememberedUserID
            }
            return
        }
        userLetGo = nil
        if let rememberedUserID, rememberedUserID != userID { analytics.reset() }
        analytics.identify(
            userID: userID, signedUpAt: signedUpAt, catalogSize: nil, storageUsed: nil, fieldsUsed: nil, settings: [])
        if userID != rememberedUserID { analytics.send(.signedIn) }
    }

    /// Call when the API reports the account deleted after Clerk already let go of its user. The
    /// event goes out unidentified: the reset already ran, and identifying the deleted user again
    /// would bring back the person the API deletes with the account.
    ///
    /// - Returns: Whether the report was for a user Clerk let go of, the first time it came.
    @discardableResult
    mutating func accountDeletedAfterClerkLetGo() -> Bool {
        guard userLetGo != nil else { return false }
        userLetGo = nil
        analytics.send(.accountDeleted)
        return true
    }
}
