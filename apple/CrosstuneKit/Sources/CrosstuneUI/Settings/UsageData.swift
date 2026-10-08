import CrosstuneAnalytics
import CrosstuneAuth
import Foundation
import SwiftUI

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

    /// The musician's own change to the setting. Turning sharing off says so first and flushes,
    /// since nothing leaves the device once it is off; turning it on only resumes sending.
    public static func change(to enabled: Bool, analytics: AnalyticsClient, defaults: UserDefaults = .standard) {
        if enabled {
            apply(true, to: analytics, defaults: defaults)
        } else {
            analytics.disableSharing(rememberedUserID: RememberedUser(defaults: defaults).userID)
        }
    }

    /// The Settings toggle: it stores the musician's choice in `stored`, then applies it as
    /// their own change.
    public static func toggle(
        _ stored: Binding<Bool>, analytics: AnalyticsClient, defaults: UserDefaults = .standard
    ) -> Binding<Bool> {
        Binding {
            stored.wrappedValue
        } set: { enabled in
            stored.wrappedValue = enabled
            change(to: enabled, analytics: analytics, defaults: defaults)
        }
    }

    /// Applies the stored choice. The app calls it right after starting analytics, before the
    /// session exists; with sharing off, the SDK is never set up.
    public static func launch(_ analytics: AnalyticsClient, defaults: UserDefaults = .standard) {
        apply(isEnabled(defaults: defaults), to: analytics, defaults: defaults)
    }
}
