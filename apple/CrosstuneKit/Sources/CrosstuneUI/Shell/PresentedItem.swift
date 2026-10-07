import SwiftUI

extension Binding {
    /// Whether an optional item is set, as a dialog's `isPresented`: the dialog shows while the
    /// item is set, and dismissing it clears the item.
    func isPresent<Wrapped>() -> Binding<Bool> where Value == Wrapped? {
        // A key path rather than get and set closures, which would capture this non-Sendable
        // binding in the `@Sendable` closures `Binding(get:set:)` takes.
        self[dynamicMember: \.isSet]
    }
}

extension Optional {
    /// Whether a value is set. Setting it false clears the value; setting it true does nothing.
    fileprivate var isSet: Bool {
        get { self != nil }
        set { if !newValue { self = nil } }
    }
}
