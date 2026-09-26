import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneStore

private func serverTune(
    id: String, title: String = "Server Tune", updatedAt: Timestamp = noon, serverSeq: Int64 = 1
) -> JSONObject {
    [
        "id": .string(id),
        "created_at": .string(noon.iso),
        "updated_at": .string(updatedAt.iso),
        "deleted_at": .null,
        "server_seq": .integer(serverSeq),
        "owner_user_id": .string("server-user"),
        "title": .string(title),
        "alternate_titles": .array([]),
        "genre": .null,
        "tune_type": .null,
        "modes": .array([]),
        "composer": .null,
        "lyrics": .null,
        "key": .null,
        "part_structure": .null,
        "time_signature": .null,
        "is_crooked": .bool(false),
        "tunings": .object([:]),
    ]
}

private func serverUserTune(
    id: String, tuneID: String, status: String = "known", updatedAt: Timestamp = noon, serverSeq: Int64 = 2
) -> JSONObject {
    [
        "id": .string(id),
        "created_at": .string(noon.iso),
        "updated_at": .string(updatedAt.iso),
        "deleted_at": .null,
        "server_seq": .integer(serverSeq),
        "user_id": .string("server-user"),
        "tune_id": .string(tuneID),
        "status": .string(status),
        "learned_from": .null,
        "learned_on": .null,
        "notes": .null,
        "archived_at": .null,
    ]
}

/// Puts a tune and its user tune in one transaction, as the create-tune command will, so the
/// outbox holds one entry for each in that order.
private func createTune(_ store: CrosstuneStore, title: String, status: String = "known") async throws -> (
    tune: Tune, userTune: UserTune
) {
    let tune = Tune(createdAt: noon, title: title)
    let userTune = UserTune(createdAt: noon, tuneID: tune.id, status: status)
    try await store.write { writer in
        try writer.put(tune, at: noon)
        try writer.put(userTune, at: noon)
    }
    return (tune, userTune)
}

@Suite struct ApplyPushResultsTests {
    @Test func storesTheServerRowAndClearsTheEntryOnApplied() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tune, userTune) = try await createTune(store, title: "X")
        let sent = try await store.pendingChanges(limit: 10)

        try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [
                    PushResult(
                        table: .tunes, id: tune.id, status: .applied,
                        row: serverTune(id: tune.id, title: "X", serverSeq: 44)),
                    PushResult(table: .userTunes, id: userTune.id, status: .applied),
                ])
        }

        let stored = try await store.read { db in try Tune.fetchOne(db, key: tune.id) }
        #expect(stored?.serverSeq == 44)
        #expect(stored?.extra == [:])
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func lastResultWinsWhenTheServerRepeatsARow() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tune = Tune(createdAt: noon, title: "X")
        try await store.write { writer in try writer.put(tune, at: noon) }
        let sent = try await store.pendingChanges(limit: 10)

        let result = try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [
                    PushResult(
                        table: .tunes, id: tune.id, status: .applied, row: serverTune(id: tune.id, title: "first")),
                    PushResult(
                        table: .tunes, id: tune.id, status: .applied, row: serverTune(id: tune.id, title: "second")),
                ])
        }

        #expect(try await store.read { db in try Tune.fetchOne(db, key: tune.id) }?.title == "second")
        #expect(result.settled == 1)
    }

    @Test func overwritesTheLocalRowOnStaleAndReportsTheRejectionOnInvalid() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tune, userTune) = try await createTune(store, title: "Mine")
        let sent = try await store.pendingChanges(limit: 10)

        let result = try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [
                    PushResult(
                        table: .tunes, id: tune.id, status: .stale,
                        row: serverTune(id: tune.id, title: "Theirs", updatedAt: later(2 * 3_600_000))),
                    PushResult(table: .userTunes, id: userTune.id, status: .invalid, reason: "nope"),
                ])
        }

        #expect(try await store.read { db in try Tune.fetchOne(db, key: tune.id) }?.title == "Theirs")
        #expect(try await store.read { db in try UserTune.fetchOne(db, key: userTune.id) }?.status == "known")
        #expect(try await store.pendingChangeCount() == 0)
        #expect(result.invalid == [InvalidChange(table: .userTunes, id: userTune.id, reason: "nope")])
        #expect(result.settled == 2)
    }

    @Test func settlesARejectedDeleteWithoutReportingIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tune, userTune) = try await createTune(store, title: "X")
        // A cascading delete drops the user tune's own entry instead of queuing its delete.
        try await store.write { writer in
            try writer.tombstone(UserTune.self, id: userTune.id, at: noon, enqueueDelete: false)
            try writer.tombstone(Tune.self, id: tune.id, at: noon)
        }
        let sent = try await store.pendingChanges(limit: 10)

        let result = try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [PushResult(table: .tunes, id: tune.id, status: .invalid, reason: "not found")])
        }

        #expect(result.invalid == [])
        #expect(result.settled == 1)
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func countsOnlyTheEntriesItSettled() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tune, _) = try await createTune(store, title: "v1")
        let sent = try await store.pendingChanges(limit: 10)

        let result = try await store.write { writer in
            try writer.applyPushResults(
                sent: sent, results: [PushResult(table: .tunes, id: tune.id, status: .applied)])
        }

        #expect(result.settled == 1)
        #expect(try await store.pendingChangeCount() == 1)
    }

    @Test func leavesAnEntryThatChangedWhileTheBatchWasInFlight() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tune, userTune) = try await createTune(store, title: "v1")
        let sent = try await store.pendingChanges(limit: 10)
        var updated = tune
        updated.title = "v2"
        try await store.write { [updated] writer in try writer.put(updated, at: later(5000)) }

        try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [
                    PushResult(table: .tunes, id: tune.id, status: .applied, row: serverTune(id: tune.id, title: "v1")),
                    PushResult(table: .userTunes, id: userTune.id, status: .applied),
                ])
        }

        #expect(try await store.read { db in try Tune.fetchOne(db, key: tune.id) }?.title == "v2")
        let pending = try await store.pendingChanges(limit: 10).first { $0.rowID == tune.id }
        #expect(pending?.data?["title"] == .string("v2"))
    }

    @Test func leavesAnEntryWrittenInTheSameMillisecondAsTheBatchItFollows() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tune, userTune) = try await createTune(store, title: "v1")
        let sent = try await store.pendingChanges(limit: 10)
        var updated = tune
        updated.title = "v2"
        try await store.write { [updated] writer in try writer.put(updated, at: noon) }

        try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [
                    PushResult(table: .tunes, id: tune.id, status: .applied, row: serverTune(id: tune.id, title: "v1")),
                    PushResult(table: .userTunes, id: userTune.id, status: .applied),
                ])
        }

        let pending = try await store.pendingChanges(limit: 10).first { $0.rowID == tune.id }
        #expect(try await store.read { db in try Tune.fetchOne(db, key: tune.id) }?.title == "v2")
        #expect(pending?.data?["title"] == .string("v2"))
        // The server takes only a strictly newer write, so the retry must not tie the first.
        let tuneSent = sent.first { $0.rowID == tune.id }
        #expect(pending!.updatedAt > tuneSent!.updatedAt)
    }
}

@Suite struct ApplyPullPageTests {
    @Test func storesRowsWithoutOwnershipDropsOlderPendingEntriesAndAdvancesTheCursor() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tune, userTune) = try await createTune(store, title: "local")

        try await store.write { writer in
            try writer.applyPullPage(
                rows: [
                    (.tunes, serverTune(id: tune.id, title: "server", serverSeq: 3)),
                    (.userTunes, serverUserTune(id: userTune.id, tuneID: tune.id, serverSeq: 4)),
                    (.tunes, serverTune(id: "other", title: "Other", serverSeq: 5)),
                ], nextSince: 5)
        }

        let storedTune = try await store.read { db in try Tune.fetchOne(db, key: tune.id) }
        #expect(storedTune?.title == "server")
        #expect(storedTune?.serverSeq == 3)
        #expect(try await store.read { db in try UserTune.fetchOne(db, key: userTune.id) }?.extra == [:])
        #expect(try await store.read { db in try Tune.fetchOne(db, key: "other") }?.title == "Other")
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await store.meta(.pullCursor, as: Int64.self) == 5)
    }

    @Test func skipsARowWithANewerLocalWriteStillPending() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tune, _) = try await createTune(store, title: "newer local")

        try await store.write { writer in
            try writer.applyPullPage(
                rows: [(.tunes, serverTune(id: tune.id, title: "older server", updatedAt: later(-3_600_000)))],
                nextSince: 9)
        }

        #expect(try await store.read { db in try Tune.fetchOne(db, key: tune.id) }?.title == "newer local")
        #expect(try await store.pendingChanges(limit: 10).contains { $0.rowID == tune.id })
        #expect(try await store.meta(.pullCursor, as: Int64.self) == 9)
    }
}
