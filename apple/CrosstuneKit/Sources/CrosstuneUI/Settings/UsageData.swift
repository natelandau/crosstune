import CrosstuneAnalytics
import CrosstuneAuth
import Foundation
import SwiftUI

/// The "Share usage data" setting: whether the app sends product analytics.
public enum UsageData {
    nonisolated public static let storageKey = "shareUsageData"
    nonisolated public static let title = "Share usage data"
    nonisolated public static let help = "Sends which features you use, never your tunes, notes, or recordings."

    /// The musician's choice, or the regional default stored in its place; nil until one exists.
    nonisolated public static func storedChoice(defaults: UserDefaults = .standard) -> Bool? {
        defaults.object(forKey: storageKey) as? Bool
    }

    /// Off until a choice exists.
    nonisolated public static func isEnabled(defaults: UserDefaults = .standard) -> Bool {
        storedChoice(defaults: defaults) ?? false
    }

    /// Whether this device shares usage data. A stored choice wins. Otherwise the region decides
    /// and the answer is stored: on where consent is not required, off where it is. An unknown
    /// region, a failed request, or no network leaves the choice unmade, so nothing is stored
    /// and sharing is off.
    public static func resolveDefault(
        defaults: UserDefaults = .standard, region: () async throws -> Region
    ) async -> Bool {
        if let stored = storedChoice(defaults: defaults) { return stored }
        guard let consentRequired = try? await region().consentRequired else { return false }
        // A choice made while the request was in flight outranks the regional default.
        if let chosen = storedChoice(defaults: defaults) { return chosen }
        let enabled = !consentRequired
        defaults.set(enabled, forKey: storageKey)
        return enabled
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

    /// Applies the stored choice at once. With none, events wait in memory while the regional
    /// default loads, then go out or are dropped as it says. The app calls it right after
    /// starting analytics, before the session exists; with sharing off, the SDK is never set up.
    /// Returns the task resolving the default, nil when a choice was stored.
    @discardableResult
    public static func launch(
        _ analytics: AnalyticsClient, defaults: UserDefaults = .standard,
        region: @escaping @Sendable () async throws -> Region
    ) -> Task<Void, Never>? {
        if let stored = storedChoice(defaults: defaults) {
            apply(stored, to: analytics, defaults: defaults)
            return nil
        }
        analytics.deferDecision()
        // On the main actor, where the Settings toggle writes the same key, so the read and the
        // write of the stored choice never interleave with it.
        return Task { @MainActor in
            let enabled = await resolveDefault(defaults: defaults, region: region)
            apply(enabled, to: analytics, defaults: defaults)
        }
    }
}
