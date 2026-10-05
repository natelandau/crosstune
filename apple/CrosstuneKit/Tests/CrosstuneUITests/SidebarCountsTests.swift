#if os(macOS)
    import CrosstuneStore
    import CrosstuneTestSupport
    import Testing

    @testable import CrosstuneUI

    private func addTune(
        _ writer: StoreWriter, _ id: String, status: String, archived: Bool = false,
        deleted: Bool = false, tuneDeleted: Bool = false
    ) throws {
        try writer.put(Tune(id: id, createdAt: noon, deletedAt: tuneDeleted ? noon : nil, title: id))
        try writer.put(
            UserTune(
                id: "u-\(id)", createdAt: noon, deletedAt: deleted ? noon : nil, tuneID: id, status: status,
                archivedAt: archived ? noon : nil))
    }

    @Suite struct SidebarCountsTests {
        private let root = TemporaryRoot()

        @Test func sidebarCountsIgnoreArchivedAndDeleted() async throws {
            let store = try root.open()
            try await store.write { writer in
                try addTune(writer, "k1", status: "known")
                try addTune(writer, "k2", status: "known")
                try addTune(writer, "l1", status: "learning")
                try addTune(writer, "k3", status: "known", archived: true)
                try addTune(writer, "l2", status: "learning", deleted: true)
                try addTune(writer, "b1", status: "bogus")
                // The catalog leaves out a tune whose shared row is gone, so the count does too.
                try addTune(writer, "g1", status: "known", tuneDeleted: true)
                try Recording(id: "r1", tuneID: "k1", source: "microphone", recordedAt: noon).insert(writer.db)
                try Recording(id: "r2", tuneID: nil, source: "microphone", recordedAt: noon).insert(writer.db)
                try Recording(id: "r3", deletedAt: noon, tuneID: "k2", source: "microphone", recordedAt: noon)
                    .insert(writer.db)
            }

            let counts = try await store.read { try SidebarCounts.fetch($0) }
            #expect(
                counts
                    == SidebarCounts(
                        catalog: 4, byStatus: ["known": 2, "learning": 1, "want_to_learn": 1], recordings: 2))
        }

        @Test func anEmptyStoreCountsNothing() async throws {
            let store = try root.open()
            let counts = try await store.read { try SidebarCounts.fetch($0) }
            #expect(counts == SidebarCounts(catalog: 0, byStatus: [:], recordings: 0))
        }
    }
#endif
