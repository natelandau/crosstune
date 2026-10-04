import CrosstuneTestSupport
import Testing

@testable import CrosstuneStore

@Test func accountCountsSkipDeletedRows() async throws {
    let root = TemporaryRoot()
    let store = try root.open()

    try await store.write { writer in
        try writer.put(Tune(createdAt: noon, title: "Soldier's Joy", modes: ["major"]))
        let tune = Tune(createdAt: noon, title: "Cluck Old Hen", modes: ["major"])
        try writer.put(tune)
        try writer.put(UserTune(createdAt: noon, tuneID: tune.id, status: "known"))
        try writer.put(UserTune(createdAt: noon, deletedAt: noon, tuneID: tune.id, status: "known"))
        try writer.put(TuneList(createdAt: noon, name: "Session set"))
        try writer.put(TuneList(createdAt: noon, deletedAt: noon, name: "Old set"))
        try writer.put(Recording(createdAt: noon, tuneID: tune.id, source: "live", addedAt: noon))
        try writer.put(Recording(createdAt: noon, deletedAt: noon, tuneID: tune.id, source: "live", addedAt: noon))
        try writer.put(Recording(createdAt: noon, tuneID: tune.id, source: "live", addedAt: noon))
    }

    let counts = try await store.accountCounts()

    #expect(counts == AccountCounts(tunes: 1, lists: 1, recordings: 2))
}
