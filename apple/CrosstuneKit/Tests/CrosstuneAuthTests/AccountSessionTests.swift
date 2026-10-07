import CrosstuneAPI
import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import Foundation
import GRDB
import OpenAPIRuntime
import Testing

@testable import CrosstuneAuth

@Test func waitsForClerkDuringTheGracePeriod() {
    let phase = AccountSession.phase(
        clerkLoaded: false, clerkUserID: nil, rememberedUserID: "user_a", graceElapsed: false)
    #expect(phase == .loading)
}

@Test func opensOnTheRememberedUserWhenClerkDoesNotLoad() {
    let phase = AccountSession.phase(
        clerkLoaded: false, clerkUserID: nil, rememberedUserID: "user_a", graceElapsed: true)
    #expect(phase == .signedIn(userID: "user_a", confirmed: false))
}

@Test func asksForSignInWhenClerkDoesNotLoadAndNoOneIsRemembered() {
    let phase = AccountSession.phase(
        clerkLoaded: false, clerkUserID: nil, rememberedUserID: nil, graceElapsed: true)
    #expect(phase == .signedOut)
}

@Test func trustsClerkOnceItLoads() {
    let signedIn = AccountSession.phase(
        clerkLoaded: true, clerkUserID: "user_b", rememberedUserID: "user_a", graceElapsed: false)
    #expect(signedIn == .signedIn(userID: "user_b", confirmed: true))

    let signedOut = AccountSession.phase(
        clerkLoaded: true, clerkUserID: nil, rememberedUserID: "user_a", graceElapsed: true)
    #expect(signedOut == .signedOut)
}

@Test func isOfflineWithoutANetworkEvenWhenClerkRestoredTheUser() {
    let restored = AccountSession.Phase.signedIn(userID: "user_a", confirmed: true)
    #expect(AccountSession.isOffline(phase: restored, hasNetwork: false))
    #expect(!AccountSession.isOffline(phase: restored, hasNetwork: true))
}

@Test func isOfflineUntilClerkLoads() {
    let remembered = AccountSession.Phase.signedIn(userID: "user_a", confirmed: false)
    #expect(AccountSession.isOffline(phase: remembered, hasNetwork: true))
}

@Test func aFailedDeleteReadsAsNothingChanged() {
    #expect(AccountSession.LeaveError.deleteFailed.errorDescription == AccountSession.LeaveError.deleteFailedMessage)
}

@Test func anUnconfirmedDeleteSaysTheAccountMayBeGone() {
    #expect(
        AccountSession.LeaveError.deleteUnconfirmed.errorDescription
            == AccountSession.LeaveError.deleteUnconfirmedMessage)
}

private typealias DeleteOutput = Operations.DeleteMeV1MeDelete.Output

private func problem(_ status: Int) -> Components.Schemas.Problem {
    .init(detail: "", status: status, title: "Error")
}

@Test func aDeleteTheAPIRefusedChangedNothing() async {
    await #expect(throws: APIStatusError(status: 502)) {
        try await AccountSession.deleteRemote {
            DeleteOutput.badGateway(.init(body: .applicationProblemJson(problem(502))))
        }
    }
    await #expect(throws: APIStatusError(status: 403)) {
        try await AccountSession.deleteRemote { DeleteOutput.undocumented(statusCode: 403, .init()) }
    }
}

@Test func aDeleteWithNoAnswerFromTheAPIIsUnconfirmed() async {
    await #expect(throws: AccountSession.LeaveError.deleteUnconfirmed) {
        try await AccountSession.deleteRemote { throw URLError(.networkConnectionLost) }
    }
    await #expect(throws: AccountSession.LeaveError.deleteUnconfirmed) {
        try await AccountSession.deleteRemote { DeleteOutput.undocumented(statusCode: 504, .init()) }
    }
    await #expect(throws: AccountSession.LeaveError.deleteUnconfirmed) {
        try await AccountSession.deleteRemote { DeleteOutput.undocumented(statusCode: 500, .init()) }
    }
}

@Test func aDeletedUserIsSignedOutEvenWhileClerkStillHoldsTheirSession() {
    let phase = AccountSession.phase(
        clerkLoaded: true, clerkUserID: "user_a", rememberedUserID: nil, graceElapsed: true,
        signedOutUserID: "user_a")
    #expect(phase == .signedOut)
}

@Test func anotherUserSignsInPastADeletedOne() {
    let phase = AccountSession.phase(
        clerkLoaded: true, clerkUserID: "user_b", rememberedUserID: nil, graceElapsed: true,
        signedOutUserID: "user_a")
    #expect(phase == .signedIn(userID: "user_b", confirmed: true))
}

@Test func aDeletionReportedWhileSignedInLeavesThatUser() {
    for confirmed in [true, false] {
        #expect(
            AccountSession.deletionReport(
                phase: .signedIn(userID: "user_a", confirmed: confirmed), isLeavingDeleted: false)
                == .leave(userID: "user_a"))
    }
}

@Test func aDeletionReportedWithNoUserOpenGoesToTheUserClerkLetGo() {
    #expect(AccountSession.deletionReport(phase: .signedOut, isLeavingDeleted: false) == .afterClerkLetGo)
    #expect(AccountSession.deletionReport(phase: .loading, isLeavingDeleted: false) == .afterClerkLetGo)
}

@Test func aDeletionReportedWhileAlreadyLeavingIsIgnored() {
    for phase: AccountSession.Phase in [.signedIn(userID: "user_a", confirmed: true), .signedOut, .loading] {
        #expect(AccountSession.deletionReport(phase: phase, isLeavingDeleted: true) == .ignore)
    }
}

@Test func remembersAndForgetsTheUser() throws {
    let suite = TemporaryDefaults()
    let defaults = suite.defaults
    let remembered = RememberedUser(defaults: defaults)

    remembered.userID = "user_a"
    #expect(RememberedUser(defaults: defaults).userID == "user_a")

    remembered.userID = nil
    #expect(RememberedUser(defaults: defaults).userID == nil)
}

@Test func remembersADeletedUserAcrossLaunchesUntilForgotten() throws {
    let suite = TemporaryDefaults()
    let defaults = suite.defaults

    RememberedUser(defaults: defaults).deletedUserID = "user_a"
    #expect(RememberedUser(defaults: defaults).deletedUserID == "user_a")

    RememberedUser(defaults: defaults).deletedUserID = nil
    #expect(RememberedUser(defaults: defaults).deletedUserID == nil)
}

/// After a relaunch Clerk can restore a deleted user from its cache. The stored mask keeps
/// the app signed out, so that user is never identified again.
@Test func aRelaunchWithClerkStillHoldingADeletedUserStaysSignedOut() throws {
    let suite = TemporaryDefaults()
    let defaults = suite.defaults
    RememberedUser(defaults: defaults).deletedUserID = "user_a"

    let relaunched = RememberedUser(defaults: defaults)
    let phase = AccountSession.phase(
        clerkLoaded: true, clerkUserID: "user_a", rememberedUserID: relaunched.userID, graceElapsed: true,
        signedOutUserID: relaunched.deletedUserID)
    #expect(phase == .signedOut)
}

/// Records each step of leaving, sync controls and session end alike, in order.
@MainActor
final class LeaveLog: LeavingSync {
    var steps: [String] = []
    /// Runs as the sync, as the engine would push the outbox.
    var onSync: () async throws -> Void = {}
    /// Runs while sync stops, as a write the musician makes in that wait would.
    var onStop: () async throws -> Void = {}

    func sync() async {
        steps.append("sync")
        try? await onSync()
    }

    func stop() async {
        steps.append("stop")
        await Task.yield()
        try? await onStop()
        steps.append("stopped")
    }

    func resume() { steps.append("resume") }
}

struct ClerkFailed: Error {}

@MainActor
@Suite struct LeaveTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let log = LeaveLog()
    let sink = RecordingAnalyticsSink()

    init() throws {
        store = try root.open()
    }

    var folderExists: Bool { FileManager.default.fileExists(atPath: store.folder.path()) }

    func leave(endSession: () async throws -> Void = {}, settle: () async -> Void = {}) async throws {
        let log = log
        try await AccountSession.leave(
            userID: "user_a", store: store, root: root.url, sync: log, analytics: sink.client, settle: settle
        ) {
            log.steps.append("end session")
            try await endSession()
        }
    }

    func queueChange() async throws {
        try await store.write { writer in try writer.put(Tune(title: "Leather Britches")) }
    }

    func putRecordingFile(_ state: LocalFileState) async throws {
        try await store.write { writer in try RecordingFile(id: "r1", localState: state).insert(writer.db) }
    }

    @Test func signOutSyncsThenStopsThenEndsTheSessionThenDeletesTheFolder() async throws {
        try await leave()

        #expect(log.steps == ["sync", "stop", "stopped", "end session"])
        #expect(!folderExists)
    }

    @Test func signOutChecksTheOutboxAfterTheSync() async throws {
        try await queueChange()
        let store = store
        log.onSync = { try await store.write { writer in try OutboxEntry.deleteAll(writer.db) } }

        try await leave()

        #expect(!folderExists)
    }

    @Test func leavingFinishesHeldBackWritesBeforeCheckingTheOutbox() async throws {
        let log = log
        await #expect(throws: AccountSession.LeaveError.unsyncedChanges) {
            try await leave {
            } settle: {
                log.steps.append("settle")
                try? await queueChange()
            }
        }
        #expect(log.steps == ["settle", "sync"])
        #expect(folderExists)
    }

    @Test func signOutRefusesAnEditMadeWhileSyncStops() async throws {
        log.onStop = { try await queueChange() }

        await #expect(throws: AccountSession.LeaveError.unsyncedChanges) {
            try await leave()
        }

        #expect(log.steps == ["sync", "stop", "stopped", "resume"])
        #expect(folderExists)
    }

    @Test func signOutKeepsTheFolderForAnEditMadeWhileTheSessionEnds() async throws {
        try await leave { try await queueChange() }

        #expect(log.steps == ["sync", "stop", "stopped", "end session"])
        #expect(folderExists)
        #expect(store.isClosed)
    }

    @Test func signOutRefusesWhileChangesAreUnsent() async throws {
        try await queueChange()

        await #expect(throws: AccountSession.LeaveError.unsyncedChanges) {
            try await leave()
        }

        #expect(log.steps == ["sync"])
        #expect(folderExists)
    }

    @Test func leaveIgnoresPendingEvents() async throws {
        let play = PlayEvent(context: "row", startedAt: .now, listenedMs: 12_000, recordingID: "r1")
        let view = ScanView(tuneID: "t1", context: "row", startedAt: .now, viewedMs: 3_000)
        try await store.write { writer in
            try writer.record(play)
            try writer.record(view)
        }
        #expect(try await store.pendingChangeCount() == 2)

        try await leave()

        #expect(log.steps == ["sync", "stop", "stopped", "end session"])
        #expect(!folderExists)
    }

    @Test func signOutRefusesWhileARecordingIsNotUploaded() async throws {
        for state in LocalFileState.notUploaded {
            try await putRecordingFile(state)

            await #expect(throws: AccountSession.LeaveError.unuploadedRecordings) {
                try await leave()
            }

            try await store.write { writer in try RecordingFile.deleteAll(writer.db) }
        }
        #expect(log.steps == Array(repeating: "sync", count: LocalFileState.notUploaded.count))
        #expect(folderExists)
    }

    func putScan(origin: ScanOrigin) async throws {
        try await store.write { writer in
            try Tune(id: "t1", title: "Soldier's Joy").insert(writer.db)
            try ScanRecord(id: "p1", tuneID: "t1", width: 600, height: 800).insert(writer.db)
            try ScanFile(scanID: "p1", fileName: "p1-a.jpg", origin: origin).insert(writer.db)
        }
    }

    @Test func signOutRefusedWithUnuploadedScan() async throws {
        try await putScan(origin: .captured)

        await #expect(throws: AccountSession.LeaveError.unuploadedScans) {
            try await leave()
        }

        #expect(log.steps == ["sync"])
        #expect(folderExists)
        #expect(
            AccountSession.LeaveError.unuploadedScans.errorDescription
                == AccountSession.LeaveError.unuploadedScansMessage)
        #expect(
            AccountSession.LeaveError.unuploadedScansMessage
                == "Some scans have not uploaded yet. Delete them from their tune, or wait until they upload.")
    }

    @Test func signOutNamesUnuploadedRecordingsBeforeScans() async throws {
        try await putRecordingFile(.captured)
        try await putScan(origin: .captured)

        await #expect(throws: AccountSession.LeaveError.unuploadedRecordings) {
            try await leave()
        }
    }

    @Test func signOutLeavesWithScansTheServerHas() async throws {
        try await putScan(origin: .downloaded)

        try await leave()

        #expect(!folderExists)
    }

    @Test func signOutChecksRecordingsAfterTheSync() async throws {
        try await putRecordingFile(.captured)
        let store = store
        log.onSync = {
            try await store.write { writer in
                try RecordingFile(id: "r1", localState: .uploaded).update(writer.db)
            }
        }

        try await leave()

        #expect(!folderExists)
    }

    @Test func signOutLeavesWithRecordingsTheServerHas() async throws {
        try await putRecordingFile(.downloaded)

        try await leave()

        #expect(!folderExists)
    }

    func deleteAndLeave(
        deleteRemote: () async throws -> Void = {}, endSession: () async throws -> Void = {}
    ) async throws {
        let log = log
        try await AccountSession.deleteAndLeave(
            userID: "user_a", store: store, root: root.url, sync: log, analytics: sink.client,
            deleteRemote: {
                log.steps.append("deleteRemote")
                try await deleteRemote()
            },
            endSession: {
                log.steps.append("end session")
                try await endSession()
            }
        )
    }

    @Test func deletingStopsSyncBeforeTheRequest() async throws {
        try await deleteAndLeave()

        #expect(log.steps == ["stop", "stopped", "deleteRemote", "end session"])
        #expect(!folderExists)
    }

    @Test func aFailedDeleteKeepsTheStoreAndResumesSync() async throws {
        await #expect(throws: ClerkFailed.self) {
            try await deleteAndLeave(deleteRemote: { throw ClerkFailed() })
        }

        #expect(log.steps == ["stop", "stopped", "deleteRemote", "resume"])
        #expect(folderExists)
    }

    @Test func deletingWipesTheStoreEvenWhenEndingTheSessionFails() async throws {
        try await deleteAndLeave(endSession: { throw ClerkFailed() })

        #expect(!folderExists)
    }

    @Test func deletingIgnoresUnsentChanges() async throws {
        try await queueChange()
        try await putRecordingFile(.captured)
        #expect(try await store.pendingChangeCount() == 1)

        try await deleteAndLeave()

        #expect(!log.steps.contains("sync"))
        #expect(!folderExists)
    }

    @Test func deletingSucceedsEvenWhenTheFolderDeleteFails() async throws {
        // An invalid user ID makes `CrosstuneStore.delete` throw before touching the
        // filesystem, forcing the failure this test needs without a store folder to break.
        try await AccountSession.deleteAndLeave(
            userID: "not a valid id", store: store, root: root.url, sync: log, analytics: sink.client,
            deleteRemote: {}, endSession: {}
        )

        #expect(folderExists)
    }

    func forgetDeleted(endSession: () async throws -> Void = {}) async {
        let log = log
        await AccountSession.forgetDeleted(
            userID: "user_a", store: store, root: root.url, sync: log, analytics: sink.client
        ) {
            log.steps.append("end session")
            try await endSession()
        }
    }

    @Test func anAccountDeletedElsewhereStopsSyncThenEndsTheSessionThenDeletesTheFolder() async throws {
        try await queueChange()

        await forgetDeleted()

        #expect(log.steps == ["stop", "stopped", "end session"])
        #expect(!folderExists)
    }

    @Test func anAccountDeletedElsewhereDeletesTheFolderEvenWhenEndingTheSessionFails() async throws {
        await forgetDeleted { throw ClerkFailed() }

        #expect(!log.steps.contains("resume"))
        #expect(!folderExists)
    }

    @Test func signOutSendsSignedOutThenResetsOnceTheSessionEnds() async throws {
        var callsWhileEnding: [RecordingAnalyticsSink.Call] = [.reset]

        try await leave { callsWhileEnding = sink.calls }

        #expect(callsWhileEnding.isEmpty)
        #expect(sink.calls == [.capture("signed_out", [:]), .reset])
    }

    @Test func aSignOutThatDoesNotEndTheSessionKeepsTheUser() async throws {

        await #expect(throws: ClerkFailed.self) {
            try await leave { throw ClerkFailed() }
        }

        #expect(sink.calls.isEmpty)
    }

    @Test func deletingFlushesThenResetsThenSendsAccountDeletedUnidentified() async throws {
        var callsAtTheRequest: [RecordingAnalyticsSink.Call] = []

        try await deleteAndLeave(deleteRemote: { callsAtTheRequest = sink.calls })

        // The upload of the user's queued events starts before the request.
        #expect(callsAtTheRequest == [.flush])
        #expect(sink.calls == [.flush, .reset, .capture("account_deleted", [:])])
    }

    @Test func aDeleteTheAPIRefusedKeepsTheUser() async throws {

        await #expect(throws: ClerkFailed.self) {
            try await deleteAndLeave(deleteRemote: { throw ClerkFailed() })
        }

        #expect(sink.calls == [.flush])
    }

    @Test func anAccountDeletedElsewhereResetsThenSendsAccountDeletedUnidentified() async {

        await forgetDeleted { throw ClerkFailed() }

        #expect(sink.calls == [.reset, .capture("account_deleted", [:])])
    }

    @Test func theNextUserNeverInheritsTheLastOnesPerson() async throws {

        var identity = AnalyticsIdentity(analytics: sink.client)
        identity.userChanged(to: "user_a", from: nil, isLeaving: false, signedUpAt: nil)

        try await leave()
        // Leaving has forgotten the remembered user by the time Clerk reports none.
        identity.userChanged(to: nil, from: nil, isLeaving: false, signedUpAt: nil)
        identity.userChanged(to: "user_b", from: nil, isLeaving: false, signedUpAt: nil)

        #expect(
            sink.calls == [
                .identify("user_a", set: [:], setOnce: [:]), .capture("signed_in", [:]),
                .capture("signed_out", [:]), .reset,
                .identify("user_b", set: [:], setOnce: [:]), .capture("signed_in", [:]),
            ])
        let afterReset = sink.calls.drop(while: { $0 != .reset })
        #expect(!afterReset.isEmpty)
        #expect(!afterReset.contains { if case .identify("user_a", _, _) = $0 { true } else { false } })
    }

    @Test func syncResumesAndTheFolderStaysWhenTheSessionDoesNotEnd() async throws {
        await #expect(throws: ClerkFailed.self) {
            try await leave { throw ClerkFailed() }
        }

        #expect(log.steps == ["sync", "stop", "stopped", "end session", "resume"])
        #expect(folderExists)
        #expect(try await store.pendingChangeCount() == 0)
    }
}

/// When Clerk reports a user, as the sign-up day it gives.
private let signedUpAt = Date(timeIntervalSince1970: 1_791_374_400)

@MainActor
@Suite struct AnalyticsIdentityTests {
    let sink = RecordingAnalyticsSink()

    @Test func aNewUserIsIdentifiedThenSignedIn() {
        var identity = AnalyticsIdentity(analytics: sink.client)

        identity.userChanged(to: "user_a", from: nil, isLeaving: false, signedUpAt: signedUpAt)

        #expect(
            sink.calls == [
                .identify("user_a", set: [:], setOnce: ["signed_up_at": .string("2026-10-07T12:00:00Z")]),
                .capture("signed_in", [:]),
            ])
    }

    @Test func aRelaunchForTheRememberedUserOnlyIdentifies() {
        var identity = AnalyticsIdentity(analytics: sink.client)

        identity.userChanged(to: "user_a", from: "user_a", isLeaving: false, signedUpAt: signedUpAt)

        #expect(
            sink.calls == [
                .identify("user_a", set: [:], setOnce: ["signed_up_at": .string("2026-10-07T12:00:00Z")])
            ])
    }

    @Test func anotherUserInPlaceOfTheRememberedOneStartsANewPerson() {
        var identity = AnalyticsIdentity(analytics: sink.client)

        identity.userChanged(to: "user_b", from: "user_a", isLeaving: false, signedUpAt: nil)

        #expect(
            sink.calls == [
                .reset, .identify("user_b", set: [:], setOnce: [:]), .capture("signed_in", [:]),
            ])
    }

    @Test func aSessionThatEndsOutsideTheAppForgetsThePerson() {
        var identity = AnalyticsIdentity(analytics: sink.client)

        identity.userChanged(to: nil, from: "user_a", isLeaving: false, signedUpAt: nil)

        #expect(sink.calls == [.reset])
    }

    @Test func aSessionTheAppIsEndingLeavesTheResetToLeaving() {
        var identity = AnalyticsIdentity(analytics: sink.client)

        identity.userChanged(to: nil, from: "user_a", isLeaving: true, signedUpAt: nil)
        identity.userChanged(to: nil, from: nil, isLeaving: false, signedUpAt: nil)
        identity.accountDeletedAfterClerkLetGo()

        #expect(sink.calls.isEmpty)
    }

    @Test func aDeletionReportedAfterClerkLetGoOfTheUserStillCountsOnce() {
        var identity = AnalyticsIdentity(analytics: sink.client)
        identity.userChanged(to: "user_a", from: nil, isLeaving: false, signedUpAt: nil)

        identity.userChanged(to: nil, from: "user_a", isLeaving: false, signedUpAt: nil)
        // True once, so the deleted notice shows for the user Clerk let go of.
        let first = identity.accountDeletedAfterClerkLetGo()
        let second = identity.accountDeletedAfterClerkLetGo()
        #expect(first)
        #expect(!second)

        #expect(
            sink.calls == [
                .identify("user_a", set: [:], setOnce: [:]), .capture("signed_in", [:]), .reset,
                .capture("account_deleted", [:]),
            ])
    }

    /// A relaunch where Clerk restores a deleted user from its cache: the mask, read back from
    /// the remembered user as the session's init does, keeps that user unidentified.
    @Test func aMaskedDeletedUserAfterARelaunchIsNeverIdentified() {
        let suite = TemporaryDefaults()
        let remembered = RememberedUser(defaults: suite.defaults)
        remembered.deletedUserID = "user_a"
        var identity = AnalyticsIdentity(analytics: sink.client)
        var mask = remembered.deletedUserID

        let userID = AccountSession.follow(
            clerkUserID: "user_a", signedUpAt: signedUpAt, isLeaving: false, signedOutUserID: &mask,
            remembered: remembered, identity: &identity)

        #expect(userID == nil)
        #expect(mask == "user_a")
        #expect(remembered.userID == nil)
        #expect(sink.calls.isEmpty)
    }

    @Test func anotherUserPastTheMaskIsIdentifiedAndTheMaskDropped() {
        let suite = TemporaryDefaults()
        let remembered = RememberedUser(defaults: suite.defaults)
        remembered.deletedUserID = "user_a"
        var identity = AnalyticsIdentity(analytics: sink.client)
        var mask = remembered.deletedUserID

        let userID = AccountSession.follow(
            clerkUserID: "user_b", signedUpAt: nil, isLeaving: false, signedOutUserID: &mask,
            remembered: remembered, identity: &identity)

        #expect(userID == "user_b")
        #expect(mask == nil)
        #expect(remembered.userID == "user_b")
        #expect(sink.calls == [.identify("user_b", set: [:], setOnce: [:]), .capture("signed_in", [:])])
    }

    @Test func aDeletionReportedWithNoUserLetGoSendsNothing() {
        var identity = AnalyticsIdentity(analytics: sink.client)

        let counted = identity.accountDeletedAfterClerkLetGo()
        #expect(!counted)

        #expect(sink.calls.isEmpty)
    }

    @Test func aDeletionReportedAfterTheNextSignInIsNotTheNextUsers() {
        var identity = AnalyticsIdentity(analytics: sink.client)
        identity.userChanged(to: nil, from: "user_a", isLeaving: false, signedUpAt: nil)
        identity.userChanged(to: "user_b", from: nil, isLeaving: false, signedUpAt: nil)

        identity.accountDeletedAfterClerkLetGo()

        #expect(!sink.captures.contains { $0.name == "account_deleted" })
    }
}

@Test func storeFiguresCountLiveTunesAndTheStoredStorageUse() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await store.write { writer in
        let tune = Tune(title: "Cluck Old Hen")
        try writer.put(tune)
        try writer.put(UserTune(tuneID: tune.id, status: "known"))
        try writer.put(UserTune(deletedAt: .now, tuneID: tune.id, status: "known"))
    }
    try await store.setMeta(.storage, to: StorageFigures(usedBytes: 20_000_000, quotaBytes: 0, maxFileBytes: 0))

    let figures = await AccountSession.storeFigures(in: store)

    #expect(figures.catalogSize == 1)
    #expect(figures.storageUsed == 20_000_000)
}

@Test func storeFiguresWaitForTheFirstSync() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    try await store.write { writer in
        let tune = Tune(title: "Cluck Old Hen")
        try writer.put(tune)
        try writer.put(UserTune(tuneID: tune.id, status: "known"))
    }

    let figures = await AccountSession.storeFigures(in: store)

    #expect(figures.catalogSize == nil)
    #expect(figures.storageUsed == nil)
}

@MainActor
@Test func identifyingWithStoreFiguresCarriesThemOnceASyncHasStoredThem() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let sink = RecordingAnalyticsSink()
    try await store.write { writer in
        let tune = Tune(title: "Cluck Old Hen")
        try writer.put(tune)
        try writer.put(UserTune(tuneID: tune.id, status: "known"))
    }

    let before = await AccountSession.identify(
        userID: "user_a", withFiguresIn: store, analytics: sink.client, canIdentify: { true })
    try await store.setMeta(.storage, to: StorageFigures(usedBytes: 20_000_000, quotaBytes: 0, maxFileBytes: 0))
    let after = await AccountSession.identify(
        userID: "user_a", withFiguresIn: store, analytics: sink.client, canIdentify: { true })

    #expect(!before)
    #expect(after)
    #expect(
        sink.calls == [
            .identify("user_a", set: [:], setOnce: [:]),
            .identify(
                "user_a",
                set: [
                    "catalog_size": .string(Bucket.count(1)), "storage_used": .string(Bucket.bytes(20_000_000)),
                ], setOnce: [:]),
        ])
}

@MainActor
@Test func identifyingWithStoreFiguresNeverRevivesAResetPerson() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let sink = RecordingAnalyticsSink()
    try await store.setMeta(.storage, to: StorageFigures(usedBytes: 20_000_000, quotaBytes: 0, maxFileBytes: 0))

    let carried = await AccountSession.identify(
        userID: "user_a", withFiguresIn: store, analytics: sink.client, canIdentify: { false })

    #expect(!carried)
    #expect(sink.calls.isEmpty)
}

@Test func onlyASyncThatStoredTheFiguresIdentifiesWithThem() {
    // A returning device still holds its last session's figures, so a sync whose storage
    // call failed must not count them as fresh.
    #expect(!AccountSession.identifiesAfterSync(storedFigures: false, reported: false))
    #expect(AccountSession.identifiesAfterSync(storedFigures: true, reported: false))
    #expect(!AccountSession.identifiesAfterSync(storedFigures: true, reported: true))
}

@Test func connectivityFiresOnceWhenGoingOnline() {
    var edge = ConnectivityEdge(wasOffline: true)
    let fired = [true, false, false, true, false].map { edge.update(isOffline: $0) }
    #expect(fired == [false, true, false, false, true])
}

@Test func cleanupKeepsEveryFolderAStoreStillUses() {
    let keep = AccountSession.foldersInUse(
        signedIn: "user_a", open: "user_b", opening: "user_c", closing: ["user_d"])
    #expect(keep == ["user_a", "user_b", "user_c", "user_d"])
    #expect(AccountSession.foldersInUse(signedIn: "user_a", open: nil, opening: nil, closing: []) == ["user_a"])
}

@Test func aStoreOpenedOnlineDoesNotFireAgainForTheSameConnection() {
    // Opening a store resets the edge to the current state, since the launch sync covers it.
    var edge = ConnectivityEdge(wasOffline: false)
    let fired = edge.update(isOffline: false)
    #expect(!fired)
}

/// A server that answers every call with nothing, counting requests. A push can be held until
/// the test releases it.
@MainActor
final class CountingSyncAPI: SyncAPI {
    var pushes = 0
    var pulls = 0
    var holdsPushes = false
    private(set) var heldPush: CheckedContinuation<Void, Never>?

    func push(_ changes: [Change]) async throws -> [PushResult] {
        pushes += 1
        if holdsPushes { await withCheckedContinuation { heldPush = $0 } }
        return changes.map { PushResult(table: $0.table, id: $0.id, status: .applied) }
    }

    func pull(since: Int64) async throws -> PullPage {
        pulls += 1
        // Lets a trigger queued behind this run coalesce into it.
        await Task.yield()
        return PullPage(rows: [], nextSince: since, hasMore: false)
    }

    func events(since: Int64) async throws -> EventsPage {
        EventsPage(rows: [], nextSince: since, hasMore: false)
    }

    func storage() async throws -> StorageFigures {
        StorageFigures(usedBytes: 0, quotaBytes: 0, maxFileBytes: 0)
    }

    func resolveLink(url: String) async throws -> ResolvedLink {
        ResolvedLink(provider: "other", url: url)
    }

    func searchRecordings(q: String, providers: [String], country: String) async throws -> SearchResponse {
        SearchResponse(groups: [])
    }

    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
        throw URLError(.badURL)
    }
    func uploadFinished(recordingID: String) async throws { throw URLError(.badURL) }
    func downloadURL(recordingID: String) async throws -> DownloadURL { throw URLError(.badURL) }
    func peaksURL(recordingID: String) async throws -> PeaksURL { throw URLError(.badURL) }
    func retryRecording(recordingID: String) async throws { throw URLError(.badURL) }
    func scanUploadSlot(scanID: String, bytes: Int64) async throws -> SignedURL { throw URLError(.badURL) }
    func scanUploaded(scanID: String) async throws { throw URLError(.badURL) }
    func scanDownload(scanID: String) async throws -> SignedURL { throw URLError(.badURL) }
    func putObject(_ url: URL, file: URL, contentType: String) async throws { throw URLError(.badURL) }
    func getObject(_ url: URL, to destination: URL) async throws { throw URLError(.badURL) }

    func releasePush() {
        heldPush?.resume()
        heldPush = nil
    }
}

/// A flag the engine's offline check reads while a test flips it.
@MainActor
final class Offline {
    var isOn: Bool

    init(_ isOn: Bool) {
        self.isOn = isOn
    }
}

@MainActor
@Suite struct SessionSyncTests {
    let root = TemporaryRoot()
    let store: CrosstuneStore
    let api = CountingSyncAPI()
    let offline = Offline(false)

    init() throws {
        store = try root.open()
    }

    func session(batchSize: Int = SyncEngine.pushBatchSize) -> SessionSync {
        let offline = offline
        // Retries wait for good, so every run a test sees comes from a trigger.
        let engine = SyncEngine(
            store: store, api: api, isOffline: { offline.isOn }, batchSize: batchSize,
            sleep: { _ in try await Task.sleep(for: .seconds(86_400)) })
        return SessionSync(store: store, engine: engine, isActive: true, isOffline: offline.isOn)
    }

    func waitUntil(_ condition: () -> Bool) async throws {
        #expect(try await poll { condition() })
    }

    @Test func resumingAfterAFailedSignOutDoesNotSyncByItself() async throws {
        let session = session()
        try await waitUntil { api.pulls > 0 }
        await session.sync()
        let beforeStop = api.pulls

        await session.stop()
        session.resume()
        // A sync queued by resume would coalesce into this run and add one more pull.
        await session.sync()

        #expect(api.pulls == beforeStop + 1)
        session.shutDown()
    }

    @Test func shuttingDownEndsAMultiBatchPushBeforeItsNextBatch() async throws {
        try await store.write { writer in
            try writer.put(Tune(title: "Leather Britches"))
            try writer.put(Tune(title: "Sally Goodin"))
        }
        api.holdsPushes = true
        let session = session(batchSize: 1)
        try await waitUntil { api.heldPush != nil }

        session.shutDown()
        api.releasePush()
        await session.finished()

        #expect(api.pushes == 1)
        #expect(api.pulls == 0)
        #expect(try await store.pendingChangeCount() == 1)
    }

    @Test func aStoreOpenedOnlineSyncsOnceForTheConnectionItOpenedOn() async throws {
        let session = session()
        try await waitUntil { api.pulls > 0 }
        await session.sync()
        let before = api.pulls

        session.connectivityChanged(isOffline: false)
        // A sync the edge fired would coalesce into this run and add one more pull.
        await session.sync()

        #expect(api.pulls == before + 1)
        session.shutDown()
    }

    @Test func aStoreOpenedOfflineSyncsWhenTheConnectionReturns() async throws {
        offline.isOn = true
        let session = session()
        await session.sync()
        #expect(api.pulls == 0)

        offline.isOn = false
        session.connectivityChanged(isOffline: false)

        try await waitUntil { api.pulls == 1 }
        session.shutDown()
    }
}
