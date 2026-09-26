import CrosstuneStore
import Foundation

/// Every write a screen makes, each in its own transaction. A screen holds one alongside its
/// store and calls its methods instead of writing to the store directly.
public struct Commands: Sendable {
    public let store: CrosstuneStore

    public init(store: CrosstuneStore) {
        self.store = store
    }
}
