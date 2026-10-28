import CrosstuneTestSupport
import Foundation
import GRDB
import Observation
import Testing

@testable import CrosstuneStore

@MainActor
@Suite struct LiveQueryTests {
    /// Counts how often `query` tells its observers that `value` changed. Counts and watches
    /// again inside `onChange`, which runs on the main actor as `value` is set, so no change can
    /// land between one watch and the next.
    @MainActor private final class Publications {
        var count = 0

        func watch<Value>(_ query: LiveQuery<Value>) {
            withObservationTracking {
                _ = query.value
            } onChange: { [weak self] in
                MainActor.assumeIsolated {
                    self?.count += 1
                    self?.watch(query)
                }
            }
        }
    }

    @Test func publishesAnEquatableValueOnlyWhenItChanges() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            try writer.put(Tune(id: "t1", createdAt: noon, title: "Soldier's Joy"), at: noon)
        }
        let titles = LiveQuery(store, initial: [String]()) { db in
            try Tune.fetchAll(db).map(\.title).sorted()
        }
        try await eventually { titles.value == ["Soldier's Joy"] }
        let publications = Publications()
        publications.watch(titles)

        // A write to the table the query reads that leaves its result as it was.
        try await store.write { writer in
            try writer.put(Tune(id: "t1", createdAt: noon, title: "Soldier's Joy"), at: later(1))
        }
        // A write that changes the result, which the store delivers after the one above.
        try await store.write { writer in
            try writer.put(Tune(id: "t2", createdAt: noon, title: "Kitchen Girl"), at: later(2))
        }
        try await eventually { titles.value == ["Kitchen Girl", "Soldier's Joy"] }
        #expect(publications.count == 1)
    }
}
