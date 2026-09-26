import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneCommands

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
            link: LinkInput(
                url: "https://open.spotify.com/track/1", provider: "spotify", title: "Track", label: "studio"))

        let firstRow = try #require(try await store.read { db in try RecordingLink.fetchOne(db, key: first) })
        #expect(firstRow.position == 0)
        #expect(firstRow.title == nil)
        #expect(firstRow.label == nil)
        let secondRow = try #require(try await store.read { db in try RecordingLink.fetchOne(db, key: second) })
        #expect(secondRow.position == 1)
        #expect(secondRow.title == "Track")
        #expect(secondRow.label == "studio")

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
}
