import CrosstuneStore
import Foundation
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

@Test func remembersAndForgetsTheUser() throws {
    let suite = "crosstune.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let remembered = RememberedUser(defaults: defaults)

    remembered.userID = "user_a"
    #expect(RememberedUser(defaults: defaults).userID == "user_a")

    remembered.userID = nil
    #expect(RememberedUser(defaults: defaults).userID == nil)
}

/// A store in a folder that removes itself when the test ends.
@MainActor
private final class TemporaryStore {
    let root = FileManager.default.temporaryDirectory
        .appending(path: "crosstune-auth-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
    let store: CrosstuneStore

    init() throws {
        store = try CrosstuneStore.open(userID: "user_a", root: root)
    }

    deinit {
        try? FileManager.default.removeItem(at: root)
    }

    var folderExists: Bool { FileManager.default.fileExists(atPath: store.folder.path()) }

    func leave(keepingUnsynced: Bool, endSession: () async throws -> Void = {}) async throws {
        try await AccountSession.leave(
            userID: "user_a", store: store, root: root, keepingUnsynced: keepingUnsynced, endSession: endSession)
    }
}

private struct ClerkFailed: Error {}

@MainActor
@Test func signOutDeletesTheUsersFolder() async throws {
    let temporary = try TemporaryStore()
    var ended = false

    try await temporary.leave(keepingUnsynced: false) { ended = true }

    #expect(ended)
    #expect(!temporary.folderExists)
}

@MainActor
@Test func signOutRefusesWhileChangesAreUnsent() async throws {
    let temporary = try TemporaryStore()
    try await temporary.store.write { writer in try writer.put(Tune(title: "Leather Britches")) }
    var ended = false

    await #expect(throws: AccountSession.LeaveError.unsyncedChanges) {
        try await temporary.leave(keepingUnsynced: false) { ended = true }
    }

    #expect(!ended)
    #expect(temporary.folderExists)
}

@MainActor
@Test func deletingTheAccountDropsUnsentChanges() async throws {
    let temporary = try TemporaryStore()
    try await temporary.store.write { writer in try writer.put(Tune(title: "Leather Britches")) }

    try await temporary.leave(keepingUnsynced: true)

    #expect(!temporary.folderExists)
}

@MainActor
@Test func theFolderStaysWhenTheSessionDoesNotEnd() async throws {
    let temporary = try TemporaryStore()

    await #expect(throws: ClerkFailed.self) {
        try await temporary.leave(keepingUnsynced: false) { throw ClerkFailed() }
    }

    #expect(temporary.folderExists)
    #expect(try await temporary.store.pendingChangeCount() == 0)
}
