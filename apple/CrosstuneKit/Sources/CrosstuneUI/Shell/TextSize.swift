import SwiftUI

/// The text size choice: a shift of whole Dynamic Type steps from the system's size, 0 to
/// follow the system. Chosen per device, like the appearance, so it lives in `UserDefaults`
/// rather than the synced settings row.
public enum TextSize {
    /// The `UserDefaults` key the step offset is stored under, as an integer.
    public static let storageKey = "crosstune.textSize"
    public static let title = "Text size"
    /// The value the setting reads while no shift applies.
    public static let system = "System"

    /// iOS's body text size at each Dynamic Type size. Spacing and the percentage scale by it, so
    /// they move exactly as body text does, and a table keeps them testable on the Mac, where
    /// text does not scale.
    public static func bodyPointSize(_ size: DynamicTypeSize) -> CGFloat {
        switch size {
        case .xSmall: 14
        case .small: 15
        case .medium: 16
        case .large: 17
        case .xLarge: 19
        case .xxLarge: 21
        case .xxxLarge: 23
        case .accessibility1: 28
        case .accessibility2: 33
        case .accessibility3: 40
        case .accessibility4: 47
        case .accessibility5: 53
        @unknown default: 17
        }
    }

    /// The offsets that land on a Dynamic Type size from `system`.
    public static func offsetRange(system: DynamicTypeSize) -> ClosedRange<Int> {
        let index = sizes.firstIndex(of: system) ?? defaultIndex
        return -index...(sizes.count - 1 - index)
    }

    /// The size the app shows: `system` moved `offset` steps, held to the ends of the range.
    public static func applied(system: DynamicTypeSize, offset: Int) -> DynamicTypeSize {
        let range = offsetRange(system: system)
        let index = sizes.firstIndex(of: system) ?? defaultIndex
        return sizes[index + min(max(offset, range.lowerBound), range.upperBound)]
    }

    /// "System" while the applied size is the system's, otherwise body text's size as a whole
    /// percentage of the system's.
    public static func valueLabel(system: DynamicTypeSize, offset: Int) -> String {
        let shown = applied(system: system, offset: offset)
        guard shown != system else { return Self.system }
        let percent = (bodyPointSize(shown) / bodyPointSize(system) * 100).rounded()
        return "\(Int(percent))%"
    }

    private static let sizes = DynamicTypeSize.allCases
    private static var defaultIndex: Int { sizes.firstIndex(of: .large) ?? 0 }
}

extension EnvironmentValues {
    /// The system's Dynamic Type size, which `dynamicTypeSize` no longer shows once the text size
    /// shift applies. The root sets it; the setting's stepper counts from it.
    @Entry public var systemDynamicTypeSize: DynamicTypeSize = .large
}
