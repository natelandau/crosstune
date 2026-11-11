import SwiftUI

extension Binding {
    /// Whether an optional item is set, as a dialog's `isPresented`: the dialog shows while the
    /// item is set, and dismissing it clears the item.
    func isPresent<Wrapped>() -> Binding<Bool> where Value == Wrapped? {
        // A key path rather than get and set closures, which would capture this non-Sendable
        // binding in the `@Sendable` closures `Binding(get:set:)` takes.
        self[dynamicMember: \.isSet]
    }

    /// The optional item while it is the one with `id`, else nil. One row of many presents its
    /// own dialog from it, so the dialog's popover points at that row; clearing it clears the
    /// item only while it is that row's.
    func matching<Wrapped: Identifiable>(_ id: Wrapped.ID) -> Binding<Wrapped?>
    where Value == Wrapped?, Wrapped.ID: Sendable {
        self[dynamicMember: \.[matching: id]]
    }
}

extension Optional {
    /// Whether a value is set. Setting it false clears the value; setting it true does nothing.
    fileprivate var isSet: Bool {
        get { self != nil }
        set { if !newValue { self = nil } }
    }
}

extension Optional where Wrapped: Identifiable {
    fileprivate subscript(matching id: Wrapped.ID) -> Wrapped? {
        get { self?.id == id ? self : nil }
        set {
            if let newValue {
                self = newValue
            } else if self?.id == id {
                self = nil
            }
        }
    }
}
