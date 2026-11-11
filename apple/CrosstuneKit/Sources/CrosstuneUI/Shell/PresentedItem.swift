import SwiftUI

extension Binding {
    /// The optional item while it is the one with `id`, else nil. One row of many presents its
    /// own dialog from it, so the dialog's popover points at that row; clearing it clears the
    /// item only while it is that row's.
    func matching<Wrapped: Identifiable>(_ id: Wrapped.ID) -> Binding<Wrapped?>
    where Value == Wrapped?, Wrapped.ID: Sendable {
        self[dynamicMember: \.[matching: id]]
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
