import SwiftUI

/// Light, dark, or following the system. Chosen per device, like the remembered user, so it
/// lives in `UserDefaults` rather than the synced settings row.
public enum Appearance: String, CaseIterable, Identifiable, Sendable {
    case system
    case light
    case dark

    /// The `UserDefaults` key the choice is stored under.
    public static let storageKey = "crosstune.appearance"
    public static let title = "Appearance"

    public var id: Self { self }

    public var label: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    /// The scheme to force, or nil to follow the system.
    public var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

extension View {
    /// Applies this device's appearance and text size choices. Every scene's root calls it, so a
    /// change in Settings reaches every window at once.
    public func followsDisplaySettings() -> some View {
        modifier(DisplaySettingsModifier())
    }
}

private struct DisplaySettingsModifier: ViewModifier {
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system
    @AppStorage(TextSize.storageKey) private var offset = 0
    // Read above this modifier's own override, so it is the system's size.
    @Environment(\.dynamicTypeSize) private var system

    func body(content: Content) -> some View {
        content
            .preferredColorScheme(appearance.colorScheme)
            .dynamicTypeSize(TextSize.applied(system: system, offset: offset))
            .environment(\.systemDynamicTypeSize, system)
    }
}
