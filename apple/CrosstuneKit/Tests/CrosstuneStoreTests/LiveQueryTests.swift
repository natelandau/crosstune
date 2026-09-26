import CrosstuneTestSupport
import Foundation
import GRDB
import Observation
import Testing

@testable import CrosstuneStore

@MainActor
@Suite struct LiveQueryTests {
    /// Counts how often `query` tells its observers that `value` changed.
    @MainActor private final class Publications {
        var count = 0

        func watch<Value>(_ query: LiveQuery<Value>) {
            withObservationTracking {
                _ = query.value
            } onChange: { [weak self] in
                Task { @MainActor in
                    self?.count += 1
                    self?.watch(query)
                }
            }
        }
    }

    private func eventually(_ condition: @MainActor () -> Bool) async throws {
        #expect(try await poll { condition() })
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
        try await Task.sleep(for: .milliseconds(200))
        #expect(publications.count == 0)

        try await store.write { writer in
            try writer.put(Tune(id: "t2", createdAt: noon, title: "Kitchen Girl"), at: later(2))
        }
        try await eventually { titles.value == ["Kitchen Girl", "Soldier's Joy"] }
        #expect(publications.count == 1)
    }
}
