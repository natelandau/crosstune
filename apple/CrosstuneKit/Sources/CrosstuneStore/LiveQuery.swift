import GRDB
import Observation

/// The latest result of a store query, refetched whenever a table it read changes, so a
/// SwiftUI view that reads `value` redraws on every write that changes it.
@MainActor
@Observable
public final class LiveQuery<Value: Sendable> {
    public private(set) var value: Value
    /// The error that stopped the observation, if one did.
    public private(set) var error: (any Error)?

    @ObservationIgnored private var task: Task<Void, Never>?

    /// Shows `initial` until the first fetch finishes. Every write to a table the fetch read
    /// publishes a new value; an `Equatable` value publishes only when it changes.
    public init(_ store: CrosstuneStore, initial: Value, fetch: @escaping @Sendable (Database) throws -> Value) {
        value = initial
        follow(ValueObservation.tracking(fetch), in: store)
    }

    private init(initial: Value) {
        value = initial
    }

    fileprivate func follow<Reducer: ValueReducer>(_ observation: ValueObservation<Reducer>, in store: CrosstuneStore)
    where Reducer.Value == Value {
        let values = observation.values(in: store.database)
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

extension LiveQuery where Value: Equatable {
    /// Shows `initial` until the first fetch finishes, then publishes only a value that differs
    /// from the last, so a write that leaves the result as it was redraws nothing.
    public convenience init(
        _ store: CrosstuneStore, initial: Value, fetch: @escaping @Sendable (Database) throws -> Value
    ) {
        self.init(initial: initial)
        follow(ValueObservation.tracking(fetch).removeDuplicates(), in: store)
    }
}
