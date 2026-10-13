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

    @Test func dropsARejectedEventWithoutReportingIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let play = PlayEvent(createdAt: noon, context: "row", startedAt: noon, listenedMs: 12_000, recordingID: "r1")
        let view = ScanView(createdAt: noon, tuneID: "t1", context: "tune", startedAt: noon, viewedMs: 3_000)
        try await store.write { writer in
            try writer.record(play)
            try writer.record(view)
        }
        let sent = try await store.pendingChanges(limit: 10)

        let result = try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [
                    PushResult(table: .playEvents, id: play.id, status: .invalid, reason: "invalid fields: body"),
                    PushResult(table: .scanViews, id: view.id, status: .invalid, reason: "missing parent: tune"),
                ])
        }

        #expect(result.invalid == [])
        #expect(result.settled == 2)
        #expect(try await store.pendingChangeCount() == 0)
        let (plays, views, rejected) = try await store.read { db in
            (
                try PlayEvent.fetchCount(db), try ScanView.fetchCount(db),
                try MetaKey.invalidChanges.value(in: db, as: Int.self)
            )
        }
        #expect(plays == 0)
        #expect(views == 0)
        #expect(rejected == nil)
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

    // MARK: Plan refusals

    private func take(_ store: CrosstuneStore, id: String = "r1") async throws {
        try await store.write { writer in
            try writer.put(
                Recording(
                    id: id, createdAt: noon, tuneID: nil, source: "microphone", addedAt: noon,
                    state: "pending_upload"), at: noon)
        }
    }

    private func holds(_ store: CrosstuneStore) async throws -> Set<String> {
        try await store.read { db in try StoreWriter.premiumHolds(in: db) }
    }

    @Test func holdsATakeTheServerRefusedForPremiumAndKeepsItsEntry() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await take(store)
        let sent = try await store.pendingChanges(limit: 10)

        let result = try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [PushResult(table: .recordings, id: "r1", status: .invalid, reason: premiumRequiredReason)])
        }

        #expect(result.invalid == [])
        #expect(result.settled == 0)
        #expect(try await store.pendingChanges(limit: 10).map(\.rowID) == ["r1"])
        #expect(try await holds(store) == ["r1"])
        #expect(try await store.meta(.invalidChanges, as: Int.self) == nil)
    }

    @Test func aPullThatSupersedesAHeldTakeReleasesItsStoredHold() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await take(store)
        try await store.write { writer in try writer.holdForPremium(["r1"]) }
        let pulled: JSONObject = [
            "id": .string("r1"), "created_at": .string(noon.iso), "updated_at": .string(later(60_000).iso),
            "deleted_at": .null, "server_seq": .integer(5), "source": .string("microphone"),
            "added_at": .string(noon.iso), "recorded_at": .string(noon.iso), "recorded_precision": .string("time"),
            "position": .integer(0), "state": .string("ready"),
        ]

        try await store.write { writer in try writer.applyPullPage(rows: [(.recordings, pulled)], nextSince: 5) }

        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await store.meta(.premiumHolds, as: [String].self) == [])
    }

    @Test func anAppliedResultReleasesAHeldTake() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await take(store)
        try await take(store, id: "r2")
        try await store.write { writer in try writer.holdForPremium(["r1", "r2"]) }
        let sent = try await store.pendingChanges(limit: 10)

        try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [
                    PushResult(table: .recordings, id: "r1", status: .applied),
                    PushResult(table: .recordings, id: "r2", status: .invalid, reason: premiumRequiredReason),
                ])
        }

        #expect(try await holds(store) == ["r2"])
        #expect(try await store.pendingChanges(limit: 10).map(\.rowID) == ["r2"])
    }

    @Test func aRefusedDeleteOfAHeldTakeTheServerNeverStoredReleasesIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await take(store)
        try await store.write { writer in
            try writer.holdForPremium(["r1"])
            try writer.tombstone(Recording.self, id: "r1", at: later(1_000))
        }
        let sent = try await store.pendingChanges(limit: 10, premium: false)

        let result = try await store.write { writer in
            try writer.applyPushResults(
                sent: sent, results: [PushResult(table: .recordings, id: "r1", status: .invalid, reason: "not found")])
        }

        #expect(sent.map(\.op) == [.delete])
        #expect(result.invalid == [])
        #expect(result.settled == 1)
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await holds(store).isEmpty)
    }

    @Test func aScanRefusedForItsTuneSettlesAndMarksItsFile() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            try writer.put(ScanRecord(id: "p1", createdAt: noon, tuneID: "t2", width: 600, height: 800), at: noon)
            try ScanFile(scanID: "p1", fileName: "p1.jpg", origin: .captured).insert(writer.db)
        }
        let sent = try await store.pendingChanges(limit: 10)

        let result = try await store.write { writer in
            try writer.applyPushResults(
                sent: sent,
                results: [PushResult(table: .scans, id: "p1", status: .invalid, reason: scanTuneOnlyReason)])
        }

        #expect(result.invalid == [InvalidChange(table: .scans, id: "p1", reason: scanTuneOnlyReason)])
        #expect(result.settled == 1)
        #expect(try await store.pendingChangeCount() == 0)
        let file = try await store.read { db in try ScanFile.fetchOne(db, key: "p1") }
        #expect(file?.error == ScanFile.scanTuneOnlyError)
    }

    @Test func aFreeReadOfTheOutboxLeavesOutAHeldUpsertButNeverItsDelete() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await take(store)
        try await take(store, id: "r2")
        try await store.write { writer in try writer.holdForPremium(["r1", "r2"]) }
        try await store.write { writer in try writer.tombstone(Recording.self, id: "r2", at: later(1_000)) }

        #expect(try await store.pendingChanges(limit: 10, premium: false).map(\.rowID) == ["r2"])
        #expect(try await store.pendingChanges(limit: 10, premium: true).map(\.rowID) == ["r1", "r2"])
    }
}

@Suite struct ApplyPullPageTests {
    @Test func keepsALoopFieldThisBuildDoesNotKnow() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let loop: JSONObject = [
            "id": .string("loop-1"), "created_at": .string(noon.iso), "updated_at": .string(noon.iso),
            "deleted_at": .null, "server_seq": .integer(9), "user_id": .string("server-user"),
            "recording_id": .string("recording-1"), "label": .string("B part"), "start_ms": .integer(1500),
            "end_ms": .integer(9000), "color": .integer(2), "tempo": .integer(96),
        ]

        try await store.write { writer in
            try writer.applyPullPage(rows: [(.recordingLoops, loop)], nextSince: 9)
        }

        let stored = try #require(try await store.read { db in try RecordingLoop.fetchOne(db, key: "loop-1") })
        #expect(stored.label == "B part")
        #expect(stored.extra == ["tempo": .integer(96)])
    }

    @Test func storesAPulledEntitlementsRowWithoutOwnershipAndQueuesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let row: JSONObject = [
            "id": .string("entitlement-1"), "created_at": .string(noon.iso), "updated_at": .string(noon.iso),
            "deleted_at": .null, "server_seq": .integer(12), "user_id": .string("server-user"),
            "premium_source": .string("trial"), "premium_expires_at": .string(later(86_400_000).iso),
            "auto_renews": .bool(false), "trial_starts_at": .string(noon.iso),
            "trial_ends_at": .string(later(86_400_000).iso), "premium_quota_bytes": .integer(10_000),
            "free_quota_bytes": .integer(1_000),
            "recording_notice_seen_at": .null, "trial_reminder_seen_at": .null, "trial_end_seen_at": .null,
            "storage_addon": .bool(true),
        ]

        try await store.write { writer in
            try writer.applyPullPage(rows: [(.entitlements, row)], nextSince: 12)
        }

        let stored = try #require(try await store.read { db in try Entitlement.current(db) })
        #expect(stored.premiumSource == "trial")
        #expect(stored.trialStartsAt == noon)
        #expect(stored.trialEndsAt == later(86_400_000))
        #expect(stored.premiumQuotaBytes == 10_000)
        #expect(stored.extra == ["storage_addon": .bool(true)])
        #expect(try await store.pendingChangeCount() == 0)
        #expect(try await store.meta(.pullCursor, as: Int64.self) == 12)
    }

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
