import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneCommands

private let pageURL = "https://slippery-hill.com/recording/42"

@Suite struct LinksTests {
    @Test func appendsLinksInPositionOrderWithNullableMetadata() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))

        let first = try await commands.addLink(
            tuneID: tuneID, link: LinkInput(url: "https://youtu.be/abc", provider: "youtube", providerRef: "abc"))
        let second = try await commands.addLink(
            tuneID: tuneID,
            link: LinkInput(url: "https://open.spotify.com/track/1", provider: "spotify", title: "Track"))

        let firstRow = try #require(try await store.read { db in try RecordingLink.fetchOne(db, key: first) })
        #expect(firstRow.position == 0)
        #expect(firstRow.title == nil)
        let secondRow = try #require(try await store.read { db in try RecordingLink.fetchOne(db, key: second) })
        #expect(secondRow.position == 1)
        #expect(secondRow.title == "Track")

        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == first })
        #expect(queued.data?["url"] == .string("https://youtu.be/abc"))
        #expect(queued.data?["provider"] == .string("youtube"))
        #expect(queued.data?["title"] == .null)
        #expect(queued.data?.keys.contains("added_by_user_id") == false)
    }

    @Test func removesWithATombstone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let id = try await commands.addLink(
            tuneID: tuneID, link: LinkInput(url: "https://example.com/a", provider: "other"))

        try await commands.removeLink(id)

        let row = try #require(try await store.read { db in try RecordingLink.fetchOne(db, key: id) })
        #expect(row.deletedAt != nil)
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == id })
        #expect(queued.op == .delete)
    }

    @Test func neverReissuesAPositionFreedByRemoval() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let first = try await commands.addLink(
            tuneID: tuneID, link: LinkInput(url: "https://example.com/a", provider: "other"))
        let second = try await commands.addLink(
            tuneID: tuneID, link: LinkInput(url: "https://example.com/b", provider: "other"))
        try await commands.removeLink(first)

        let third = try await commands.addLink(
            tuneID: tuneID, link: LinkInput(url: "https://example.com/c", provider: "other"))

        let thirdRow = try #require(try await store.read { db in try RecordingLink.fetchOne(db, key: third) })
        #expect(thirdRow.position == 2)
        let secondRow = try #require(try await store.read { db in try RecordingLink.fetchOne(db, key: second) })
        #expect(Set([secondRow.position, thirdRow.position]).count == 2)
    }

    @Test func refusesALinkOnATuneThatDoesNotExist() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        await #expect(throws: CommandError.tuneNotFound) {
            try await commands.addLink(
                tuneID: "missing", link: LinkInput(url: "https://example.com", provider: "other"))
        }
    }

    @Test func addsAnImportRecordingFromALinkWithoutAFile() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let url = pageURL
        let linkID = try await commands.addLink(
            tuneID: tuneID,
            link: LinkInput(url: url, provider: "slippery_hill", providerRef: "42", title: "Sligo Session"))

        let id = try await commands.addRecordingFromLink(linkID)

        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: id) })
        #expect(row.tuneID == tuneID)
        #expect(row.source == "import")
        #expect(row.origin == "slippery_hill")
        #expect(row.originURL == url)
        #expect(row.label == "Sligo Session")
        #expect(row.state == "pending_upload")
        #expect(row.addedAt == row.createdAt)
        #expect(row.recordedAt == nil)
        #expect(row.recordedPrecision == nil)
        #expect(try await store.read { db in try RecordingFile.fetchOne(db, key: id) } == nil)
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == id })
        #expect(queued.tableName == .recordings)
        #expect(queued.data?["added_at"] == .string(row.addedAt.iso))
        #expect(queued.data?["recorded_at"] == .null)
        #expect(queued.data?["recorded_precision"] == .null)
        #expect(queued.data?["source"] == .string("import"))
        #expect(queued.data?["origin"] == .string("slippery_hill"))
        #expect(queued.data?["origin_url"] == .string(url))
        #expect(queued.data?["tune_id"] == .string(tuneID))
    }

    @Test func cutsALongLinkTitleToTheLongestRecordingLabel() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        // Each "e" plus combining accent is one character but two scalars, and the server
        // counts scalars.
        let linkID = try await commands.addLink(
            tuneID: tuneID,
            link: LinkInput(
                url: pageURL, provider: "slippery_hill", providerRef: "42",
                title: String(repeating: "e\u{301}", count: 150)))

        let id = try await commands.addRecordingFromLink(linkID)

        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: id) })
        #expect(row.label?.unicodeScalars.count == Vocabulary.Limits.Recording.label)
    }

    @Test func leavesAnUntitledLinkRecordingUnlabeled() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let linkID = try await commands.addLink(
            tuneID: tuneID,
            link: LinkInput(url: "https://slippery-hill.com/recording/1", provider: "slippery_hill", providerRef: "1"))

        let id = try await commands.addRecordingFromLink(linkID)

        let row = try #require(try await store.read { db in try Recording.fetchOne(db, key: id) })
        #expect(row.label == nil)
    }

    @Test func addingTheSameLinkAgainReturnsTheSavedRecordingAndWritesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let linkID = try await commands.addLink(
            tuneID: tuneID,
            link: LinkInput(url: pageURL, provider: "slippery_hill", providerRef: "42"))
        let first = try await commands.addRecordingFromLink(linkID)
        let queuedBefore = try await store.pendingChanges(limit: 50).count

        let second = try await commands.addRecordingFromLink(linkID)

        #expect(second == first)
        #expect(try await store.pendingChanges(limit: 50).count == queuedBefore)
        let live = try await commands.activeRecordingsForTune(tuneID)
        #expect(live.count == 1)
    }

    @Test func savesAgainOnceTheSavedRecordingIsDeleted() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let linkID = try await commands.addLink(
            tuneID: tuneID,
            link: LinkInput(url: pageURL, provider: "slippery_hill", providerRef: "42"))
        let first = try await commands.addRecordingFromLink(linkID)
        try await commands.deleteRecording(first)

        let second = try await commands.addRecordingFromLink(linkID)

        #expect(second != first)
    }

    @Test func refusesAMissingOrRemovedLink() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (tuneID, _) = try await commands.createTune(TuneInput(title: "X"), userTune: UserTuneInput(status: "known"))
        let linkID = try await commands.addLink(
            tuneID: tuneID,
            link: LinkInput(url: pageURL, provider: "slippery_hill", providerRef: "42"))
        try await commands.removeLink(linkID)

        await #expect(throws: CommandError.linkNotFound) { try await commands.addRecordingFromLink(linkID) }
        await #expect(throws: CommandError.linkNotFound) { try await commands.addRecordingFromLink("nope") }
        #expect(CommandError.linkNotFound.errorDescription == "Link not found")
    }
}

@Suite struct ClippedRecordingLabelTests {
    @Test func keepsAShortLabelWhole() {
        #expect(clippedRecordingLabel("Sligo Session") == "Sligo Session")
    }

    @Test func countsScalarsNotCharacters() {
        let clipped = clippedRecordingLabel(String(repeating: "e\u{301}", count: 150))
        #expect(clipped.unicodeScalars.count == Vocabulary.Limits.Recording.label)
        #expect(clipped.count == Vocabulary.Limits.Recording.label / 2)
    }
}
