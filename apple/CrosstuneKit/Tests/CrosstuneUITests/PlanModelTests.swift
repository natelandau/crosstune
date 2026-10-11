import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}

private func entitlement(source: String?, expiresAt: Date? = nil, trialEndsAt: Date? = nil) -> Entitlement {
    Entitlement(
        id: "entitlement-1", createdAt: noon, premiumSource: source, premiumExpiresAt: expiresAt.map(Timestamp.init),
        autoRenews: false, trialEndsAt: trialEndsAt.map(Timestamp.init), premiumQuotaBytes: 10_000,
        freeQuotaBytes: 1_000)
}

/// Stores a row as the pull does, with no queued change.
private func pull(_ row: Entitlement, into store: CrosstuneStore) async throws {
    try await store.write { writer in try row.upsert(writer.db) }
}

@MainActor
@Suite struct PlanModelTests {
    @Test func turnsFreeWhenATrialEndsWithNoStoreWrite() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let clock = PlanClock()
        let end = clock.now.addingTimeInterval(10)
        try await pull(entitlement(source: "trial", expiresAt: end, trialEndsAt: end), into: store)

        let model = PlanModel(store: store, now: { clock.now }, sleep: { try await clock.sleep($0) })

        try await eventually { model.plan.kind == .premium && clock.sleeps == [10] }
        #expect(model.entitlement?.premiumSource == "trial")
        clock.now = end
        try await eventually { model.plan.kind == .free }
        #expect(model.plan.quotaBytes == 1_000)
        #expect(try await store.pendingChangeCount() == 0)
    }

    @Test func followsAPulledRowAndDropsTheOldTimer() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let clock = PlanClock()
        let end = clock.now.addingTimeInterval(10)
        try await pull(entitlement(source: "trial", expiresAt: end, trialEndsAt: end), into: store)
        let model = PlanModel(store: store, now: { clock.now }, sleep: { try await clock.sleep($0) })
        try await eventually { clock.sleeps == [10] }

        // A comp with no trial has no turning point ahead, so it asks for no new sleep.
        try await pull(entitlement(source: "comp"), into: store)
        try await eventually { model.plan.source == "comp" && clock.cancelled == 1 }
        #expect(clock.sleeps == [10])
        #expect(model.plan.kind == .premium)
    }

    /// A clock set back by hand has no timer to wake the model, so the system's notice does.
    @Test func judgesAgainWhenTheSystemClockChanges() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let clock = PlanClock()
        let end = clock.now.addingTimeInterval(10)
        try await pull(entitlement(source: "trial", expiresAt: end, trialEndsAt: end), into: store)
        clock.now = end.addingTimeInterval(5)
        let center = NotificationCenter()
        let model = PlanModel(
            store: store, now: { clock.now }, sleep: { try await clock.sleep($0) }, notifications: center)
        try await eventually { model.plan.kind == .free }

        clock.now = end.addingTimeInterval(-5)
        center.post(name: .NSSystemClockDidChange, object: nil)

        try await eventually { model.plan.kind == .premium }
    }

    @Test func judgesAgainWhenAsked() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let clock = PlanClock()
        let end = clock.now.addingTimeInterval(10)
        try await pull(entitlement(source: "trial", expiresAt: end, trialEndsAt: end), into: store)
        clock.now = end.addingTimeInterval(5)
        let model = PlanModel(store: store, now: { clock.now }, sleep: { try await clock.sleep($0) })
        try await eventually { model.plan.kind == .free }

        clock.now = end.addingTimeInterval(-5)
        model.judgeAgain()

        #expect(model.plan.kind == .premium)
    }

    @Test func eachStoreGetsItsOwnPlanClaimAndPlayerPlan() throws {
        let root = TemporaryRoot()
        let player = PlayerModel()

        let first = StorePlan.bind(try root.open("user_a"), player: player)
        #expect(first.plan != nil && first.noticeClaim != nil)
        #expect(player.plan === first.plan)

        let second = StorePlan.bind(try root.open("user_b"), player: player)
        #expect(second.plan != nil && second.plan !== first.plan)
        #expect(second.noticeClaim != nil && second.noticeClaim !== first.noticeClaim)
        #expect(player.plan === second.plan)

        let none = StorePlan.bind(nil, player: player)
        #expect(none.plan == nil && none.noticeClaim == nil)
        #expect(player.plan == nil)
    }

    @Test func followsTheTakesHeldForPremium() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = PlanModel(store: store)

        try await store.write { writer in
            try writer.put(
                Recording(id: "r1", createdAt: noon, tuneID: nil, source: "microphone", addedAt: noon), at: noon)
            try writer.holdForPremium(["r1"])
        }
        try await eventually { model.heldForPremium == ["r1"] }
        try await store.write { writer in try writer.releasePremiumHolds(["r1"]) }
        try await eventually { model.heldForPremium.isEmpty }
    }

    @Test func readsUnknownUntilARowIsStored() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = PlanModel(store: store)
        try await eventually { model.isLoaded }
        #expect(model.plan.kind == .unknown)
        #expect(model.entitlement == nil)

        try await pull(entitlement(source: "comp"), into: store)
        try await eventually { model.plan.kind == .premium }
    }

    /// Each account's catalog is its own store, so a plan read for one never carries over to the
    /// next account signed in on the device.
    @Test func startsUnknownForAnotherAccountsStore() async throws {
        let root = TemporaryRoot()
        let first = try root.open("user_a")
        try await pull(entitlement(source: "comp"), into: first)
        let firstModel = PlanModel(store: first)
        try await eventually { firstModel.plan.kind == .premium }

        let second = try root.open("user_b")
        let secondModel = PlanModel(store: second)
        try await eventually { secondModel.isLoaded }
        #expect(secondModel.plan.kind == .unknown)
        #expect(try await second.read { db in try Entitlement.fetchCount(db) } == 0)
    }

    @Test func followsTheScanTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = PlanModel(store: store)
        try await eventually { model.isLoaded }
        #expect(model.scanTune == nil)

        try await store.write { writer in
            try writer.put(ScanRecord(id: "b", createdAt: later(1), tuneID: "tune-b", width: 1, height: 1), at: noon)
            try writer.put(ScanRecord(id: "a", createdAt: noon, tuneID: "tune-a", width: 1, height: 1), at: noon)
        }
        try await eventually { model.scanTune == "tune-a" }

        try await store.write { writer in try writer.tombstone(ScanRecord.self, id: "a", at: later(2)) }
        try await eventually { model.scanTune == "tune-b" }
    }

    @Test func leavesAScanRefusedForItsTuneOutOfTheScanTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = PlanModel(store: store)
        try await store.write { writer in
            try writer.put(ScanRecord(id: "b", createdAt: later(1), tuneID: "tune-b", width: 1, height: 1), at: noon)
            try writer.put(ScanRecord(id: "a", createdAt: noon, tuneID: "tune-a", width: 1, height: 1), at: noon)
            try ScanFile(scanID: "a", fileName: "a.jpg", origin: .captured).insert(writer.db)
        }
        try await eventually { model.scanTune == "tune-a" }

        try await store.write { writer in
            try writer.db.execute(
                sql: "UPDATE scan_files SET error = ? WHERE scan_id = 'a'", arguments: [ScanFile.scanTuneOnlyError])
        }
        try await eventually { model.scanTune == "tune-b" }
    }

    @Test func keepsAStoredScanWhoseSlotWasRefusedInTheScanTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = PlanModel(store: store)
        try await store.write { writer in
            try writer.put(ScanRecord(id: "b", createdAt: later(1), tuneID: "tune-b", width: 1, height: 1), at: noon)
            try writer.put(
                ScanRecord(id: "a", createdAt: noon, serverSeq: 3, tuneID: "tune-a", width: 1, height: 1), at: noon)
            try ScanFile(scanID: "a", fileName: "a.jpg", origin: .captured, error: ScanFile.scanTuneOnlyError)
                .insert(writer.db)
        }
        try await eventually { model.scanTune == "tune-a" }
    }
}
