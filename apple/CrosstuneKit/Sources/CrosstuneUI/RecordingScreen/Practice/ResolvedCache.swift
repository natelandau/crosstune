import SwiftUI

/// Values made once for an environment and handed back on every later frame, until the
/// environment they were made for changes. Holds at most `limit`, emptying when full, so a long
/// scroll through the ruler never grows it.
final class ResolvedCache<Key: Hashable, Context: Equatable, Value> {
    private let limit: Int
    private var context: Context?
    private var values: [Key: Value] = [:]

    init(limit: Int) {
        self.limit = limit
    }

    /// The value for `key` made in `context`, or `make`'s, kept for next time.
    func value(for key: Key, in context: Context, make: () -> Value) -> Value {
        if context != self.context {
            values.removeAll(keepingCapacity: true)
            self.context = context
        }
        if let value = values[key] { return value }
        if values.count >= limit { values.removeAll(keepingCapacity: true) }
        let value = make()
        values[key] = value
        return value
    }
}

/// What a canvas's environment holds that changes how resolved text looks.
struct TextEnvironment: Equatable {
    var colorScheme: ColorScheme
    var contrast: ColorSchemeContrast
    var dynamicTypeSize: DynamicTypeSize
    var legibilityWeight: LegibilityWeight?
    var displayScale: CGFloat
    var locale: Locale

    init(_ environment: EnvironmentValues) {
        colorScheme = environment.colorScheme
        contrast = environment.colorSchemeContrast
        dynamicTypeSize = environment.dynamicTypeSize
        legibilityWeight = environment.legibilityWeight
        displayScale = environment.displayScale
        locale = environment.locale
    }
}
