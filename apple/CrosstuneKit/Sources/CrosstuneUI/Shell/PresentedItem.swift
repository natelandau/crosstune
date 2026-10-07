import SwiftUI

extension Binding {
    /// Whether an optional item is set, as a dialog's `isPresented`: the dialog shows while the
    /// item is set, and dismissing it clears the item.
    func isPresent<Wrapped>() -> Binding<Bool> where Value == Wrapped? {
        Binding<Bool> {
            wrappedValue != nil
        } set: {
            if !$0 { wrappedValue = nil }
        }
    }
}
