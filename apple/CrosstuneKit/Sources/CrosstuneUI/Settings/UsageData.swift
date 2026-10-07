import CrosstuneAnalytics
import CrosstuneAuth
import Foundation

/// The "Share usage data" setting: whether the app sends product analytics.
public enum UsageData {
    nonisolated public static let storageKey = "shareUsageData"
    nonisolated public static let title = "Share usage data"
    nonisolated public static let footer = "Sends which features you use, never your tunes, notes, or recordings."

    nonisolated public static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: storageKey) as? Bool ?? true
    }

    /// Applies `enabled`, with the user the app remembers as signed in, which every sign-out and
    /// deletion clears.
    public static func apply(_ enabled: Bool, to analytics: AnalyticsClient, defaults: UserDefaults = .standard) {
        analytics.setEnabled(enabled, rememberedUserID: RememberedUser(defaults: defaults).userID)
    }

    /// Applies the stored choice. The app calls it right after starting analytics, before the
    /// session exists; with sharing off, the SDK is never set up.
    public static func launch(_ analytics: AnalyticsClient, defaults: UserDefaults = .standard) {
        apply(isEnabled(defaults: defaults), to: analytics, defaults: defaults)
    }
}
