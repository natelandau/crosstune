import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneShare
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// The app hands the share extension the signed-in user's tunes and limits, adds what the
/// extension saved for that user only, and drops a user's shared items only when they leave.
@MainActor
@Suite struct ShareHostTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private var container: ShareContainer { ShareContainer(root: root.url.appending(path: "group")) }

    private func host() -> ShareHost {
        ShareHost(
            container: container,
            intake: ShareIntake(container: container, resolve: nil, analytics: sink.client))
    }

    /// Closes the host's store and waits for everything it started, so nothing outlives the test.
    private func finish(_ host: ShareHost) async {
        host.storeChanged(nil)
        await host.settled()
    }

    private func shareAudio(_ fileName: String, userID: String, bytes: Int = 1_000) throws {
        let folder = root.url.appending(path: "picked-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: fileName)
        try Data(repeating: 7, count: bytes).write(to: file)
        try ShareInbox.add(
            .audio(
                fileName: fileName, sharedName: fileName, label: fileName,
                sharedAt: Int64(Date.now.timeIntervalSince1970 * 1000)),
            audioFrom: file, userID: userID,
            in: container)
    }

    private func recordings(_ store: CrosstuneStore) async throws -> [Recording] {
        try await store.read { db in try Recording.fetchAll(db) }
    }

    private func folderExists(_ userID: String) -> Bool {
        FileManager.default.fileExists(atPath: container.userFolder(userID).path(percentEncoded: false))
    }

    /// Opens `userID`'s store with one tune and waits until the host has written its list.
    private func openPublished(_ userID: String, on host: ShareHost) async throws -> CrosstuneStore {
        let store = try root.open(userID)
        _ = try await Commands(store: store).createTitleOnly(title: "Drowsy Maggie")
        host.storeChanged(store)
        try await eventually { !ShareTuneList.read(userID: userID, in: container).isEmpty }
        return store
    }

    @Test func publishesTheTuneListAndUpdatesIt() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let first = try await commands.createTitleOnly(title: "Drowsy Maggie")
        try await commands.updateTune(first.tuneID, patch: TunePatch(key: .value("D"), tuneType: .value("Reel")))
        let host = host()

        host.storeChanged(store)
        try await eventually {
            ShareTuneList.read(userID: store.userID, in: container)
                == [ShareTuneEntry(id: first.tuneID, title: "Drowsy Maggie", detail: "Reel · D")]
        }

        let second = try await commands.createTitleOnly(title: "The Silver Spear")
        try await eventually {
            ShareTuneList.read(userID: store.userID, in: container).map(\.id) == [first.tuneID, second.tuneID]
        }
        await finish(host)
    }

    @Test func publishesTheFileLimit() async throws {
        let store = try root.open()
        let host = host()
        host.storeChanged(store)

        try await store.setMeta(.storage, to: StorageUsage(usedBytes: 0, quotaBytes: 1_000_000, maxFileBytes: 500))

        try await eventually {
            ShareAccount.read(userID: store.userID, in: container) == ShareAccount(maxFileBytes: 500)
        }
        await finish(host)
    }

    @Test func setsAndClearsTheCurrentUser() async throws {
        let store = try root.open()
        let host = host()

        host.storeChanged(store)
        #expect(container.currentUserID() == store.userID)

        host.storeChanged(nil)
        #expect(container.currentUserID() == nil)
        await finish(host)
    }

    @Test func readsOnlyTheSignedInUsersInbox() async throws {
        try shareAudio("memo.m4a", userID: "user_a")
        let store = try root.open("user_b")
        let host = host()
        host.storeChanged(store)

        await host.becameActive()

        #expect(try await recordings(store).isEmpty)
        #expect(ShareInbox.pending(userID: "user_a", in: container).count == 1)
        await finish(host)
    }

    /// A store that closes without a leave, as when the session expires, keeps the user's items.
    @Test func keepsTheFolderWhenTheStoreClosesWithoutALeave() async throws {
        let host = host()
        _ = try await openPublished("user_a", on: host)

        await finish(host)

        #expect(folderExists("user_a"))
    }

    /// Signing out and deleting the account both report the user who left.
    @Test func removesTheFolderOfAUserWhoLeft() async throws {
        let host = host()
        _ = try await openPublished("user_a", on: host)

        host.userLeft("user_a")
        await host.settled()

        #expect(!folderExists("user_a"))
        #expect(container.currentUserID() == nil)
        await finish(host)
    }

    @Test func keepsTheFolderWhenTheSameUserSignsInAgain() async throws {
        let host = host()
        let store = try await openPublished("user_a", on: host)

        host.userLeft("user_a")
        host.storeChanged(store)
        await host.settled()

        #expect(folderExists("user_a"))
        await finish(host)
    }

    @Test func removesOtherUsersFoldersOnAConfirmedSignIn() async throws {
        try shareAudio("memo.m4a", userID: "user_a")
        try shareAudio("memo.m4a", userID: "user_b")
        let host = host()

        host.signInConfirmed("user_b")
        await host.settled()

        #expect(!folderExists("user_a"))
        #expect(folderExists("user_b"))
        await finish(host)
    }

    @Test func showsThePlanOnceForSharedRecordingsOnAFreeAccount() async throws {
        let store = try root.open()
        try await storeEntitlement(store, source: nil)
        try shareAudio("one.m4a", userID: store.userID)
        try shareAudio("two.m4a", userID: store.userID)
        let host = host()
        host.storeChanged(store)

        await host.becameActive()

        #expect(try await recordings(store).count == 2)
        #expect(host.plan.take())
        #expect(!host.plan.take())
        await finish(host)
    }

    @Test func holdsRefusedFilesUntilTaken() async throws {
        let store = try root.open()
        try await store.setMeta(.storage, to: StorageUsage(usedBytes: 0, quotaBytes: 1_000_000, maxFileBytes: 500))
        try shareAudio("long.m4a", userID: store.userID)
        let host = host()
        host.storeChanged(store)

        await host.becameActive()

        let expected = [SharedFileRefusal(fileName: "long.m4a", message: AudioFileCheck.tooLarge(500))]
        #expect(host.refusals.take() == expected)
        #expect(host.refusals.take().isEmpty)
        await finish(host)
    }

    @Test func dropsRefusedFilesAndThePlanWhenTheUserChanges() async throws {
        let store = try root.open()
        try await store.setMeta(.storage, to: StorageUsage(usedBytes: 0, quotaBytes: 1_000_000, maxFileBytes: 500))
        try await storeEntitlement(store, source: nil)
        try shareAudio("long.m4a", userID: store.userID)
        try shareAudio("memo.m4a", userID: store.userID, bytes: 100)
        let host = host()
        host.storeChanged(store)
        await host.becameActive()

        host.storeChanged(try root.open("user_b"))

        #expect(host.refusals.take().isEmpty)
        #expect(!host.plan.take())
        await finish(host)
    }
}
