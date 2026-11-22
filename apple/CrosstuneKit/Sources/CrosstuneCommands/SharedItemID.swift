import Foundation

private let sharedItemNamespace = UUID(uuidString: "6f1d2c3e-8a47-4b5e-9c1a-2d7e4f9b0c35")!

/// The ID of the row made from the shared item named `itemName`. Derived rather than random, so
/// an item added again after the app stopped before removing it reaches the row already made.
public func sharedItemRowID(for itemName: String) -> String {
    derivedID(name: itemName, namespace: sharedItemNamespace)
}
