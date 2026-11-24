import GRDB
import os

/// Follows one read of the store off the main actor, for a writer that keeps a copy of it
/// outside the store, such as the share extension's files and the widget summary.
enum StoreObservation {
    /// Calls `onValue` with each new value of `fetch` until the calling task is cancelled. A
    /// failure ends the follow with a warning that names `follower`.
    @concurrent
    nonisolated static func follow<Value: Equatable & Sendable>(
        _ database: DatabasePool, logger: Logger, follower: String,
        fetch: @escaping @Sendable (Database) throws -> Value,
        onValue: @Sendable (Value) -> Void
    ) async {
        do {
            for try await value in ValueObservation.tracking(fetch).removeDuplicates().values(in: database) {
                onValue(value)
            }
        } catch is CancellationError {
        } catch {
            logger.warning("\(follower, privacy: .public) stopped following the store: \(error)")
        }
    }
}
