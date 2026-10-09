import CrosstuneAnalytics
import CrosstuneStore
import Foundation

/// Keeps PostHog's person in step with the signed-in user. PostHog keeps an identified person
/// until it is reset and ignores an identify for anyone else, so a different user always
/// follows a reset.
@MainActor
struct AnalyticsIdentity {
    private let analytics: AnalyticsClient
    /// The settings this device keeps outside the store, which every identify carries.
    private let deviceSettings: @MainActor () -> [SettingChange]
    /// The assistive features the device has on, read at each identify.
    private let assistiveTech: @MainActor () -> [AssistiveTechnology]?
    /// A user Clerk let go of without the app leaving, whose account deletion the API may still
    /// report.
    private var userLetGo: String?

    init(
        analytics: AnalyticsClient = .noop, deviceSettings: @escaping @MainActor () -> [SettingChange] = { [] },
        assistiveTech: @escaping @MainActor () -> [AssistiveTechnology]? = { nil }
    ) {
        self.analytics = analytics
        self.deviceSettings = deviceSettings
        self.assistiveTech = assistiveTech
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
        // The store's figures come later, from `identify(userID:withFiguresIn:canIdentify:)`;
        // what the device itself knows goes now.
        analytics.identify(
            userID: userID, signedUpAt: signedUpAt, catalogSize: nil, storageUsed: nil, fieldsUsed: nil,
            settings: deviceSettings(), assistiveTech: assistiveTech())
        if userID != rememberedUserID { analytics.send(.signedIn) }
    }

    /// Identifies `userID` with the figures in `store` and what the device knows, unless
    /// `canIdentify` refuses once the figures are read.
    ///
    /// - Returns: Whether the identify carried the API's figures.
    func identify(
        userID: String, withFiguresIn store: CrosstuneStore, canIdentify: @MainActor () -> Bool
    ) async -> Bool {
        await AccountSession.identify(
            userID: userID, withFiguresIn: store, analytics: analytics, deviceSettings: deviceSettings(),
            assistiveTech: assistiveTech(), canIdentify: canIdentify)
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
