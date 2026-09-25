import GRDB
import Observation

/// The latest result of a store query, refetched whenever a table it read changes, so a
/// SwiftUI view that reads `value` redraws on every write.
@MainActor
@Observable
public final class LiveQuery<Value: Sendable> {
    public private(set) var value: Value
    /// The error that stopped the observation, if one did.
    public private(set) var error: (any Error)?

    @ObservationIgnored private var task: Task<Void, Never>?

    /// Shows `initial` until the first fetch finishes.
    public init(_ store: CrosstuneStore, initial: Value, fetch: @escaping @Sendable (Database) throws -> Value) {
        value = initial
        let values = ValueObservation.tracking(fetch).values(in: store.database)
        task = Task { [weak self] in
            do {
                for try await value in values {
                    self?.value = value
                }
            } catch {
                self?.error = error
            }
        }
    }

    isolated deinit {
        task?.cancel()
    }
}
