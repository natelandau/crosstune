import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
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

/// A resolver that answers from a table and counts what it was asked.
@MainActor
private final class FakeResolver {
    var answers: [String: ResolvedLink] = [:]
    private(set) var asked: [String] = []

    var resolve: LinkSheetModel.Resolve {
        { url in
            self.asked.append(url)
            return self.answers[url]
        }
    }
}

@MainActor
@Suite struct LinkSheetModelTests {
    private let root = TemporaryRoot()
    private let tuneID = SampleCatalog.entries[2].tune.id

    private func links(_ store: CrosstuneStore) async throws -> [RecordingLink] {
        let tuneID = tuneID
        return try await store.read { db in
            try RecordingLink.filter(Column("tune_id") == tuneID).fetchAll(db).filter { $0.deletedAt == nil }
        }
    }

    @Test func looksUpThePastedLinkAndShowsItsTitleBeforeTheSave() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let resolver = FakeResolver()
        let url = "https://youtu.be/dQw4w9WgXcQ"
        resolver.answers[url] = ResolvedLink(
            provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", providerRef: "dQw4w9WgXcQ",
            title: "Soldier's Joy", artworkURL: "https://i.ytimg.com/a.jpg")
        let model = LinkSheetModel(
            store: store, tuneID: tuneID, resolve: resolver.resolve, debounce: .zero)

        model.setURL("  \(url) ")
        try await eventually { model.preview == "Soldier's Joy" }
        model.setLabel(" slow version ")
        #expect(await model.save())

        // The lookup made while pasting is the one the save uses.
        #expect(resolver.asked == [url])
        let row = try #require(try await links(store).first)
        #expect(row.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        #expect(row.provider == "youtube")
        #expect(row.providerRef == "dQw4w9WgXcQ")
        #expect(row.title == "Soldier's Joy")
        #expect(row.artworkURL == "https://i.ytimg.com/a.jpg")
        #expect(row.label == "slow version")
    }

    @Test func waitsForTypingToPauseBeforeLookingUp() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let resolver = FakeResolver()
        let model = LinkSheetModel(store: store, tuneID: tuneID, resolve: resolver.resolve, debounce: .seconds(60))

        model.setURL("https://youtu.be/dQw4w9WgXcQ")
        try await Task.sleep(for: .milliseconds(50))
        #expect(resolver.asked.isEmpty)
    }

    @Test func looksUpOnlyWebAddresses() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let resolver = FakeResolver()
        let model = LinkSheetModel(store: store, tuneID: tuneID, resolve: resolver.resolve, debounce: .zero)

        model.setURL("javascript:alert(1)")
        try await Task.sleep(for: .milliseconds(100))
        #expect(resolver.asked.isEmpty)
        #expect(model.preview == nil)
    }

    @Test func cancelsALookupWaitingForTypingToPause() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let resolver = FakeResolver()
        let model = LinkSheetModel(
            store: store, tuneID: tuneID, resolve: resolver.resolve, debounce: .milliseconds(30))

        model.setURL("https://youtu.be/dQw4w9WgXcQ")
        model.cancel()
        try await Task.sleep(for: .milliseconds(150))
        #expect(resolver.asked.isEmpty)
    }

    @Test func cancelsALookupInFlight() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        var started = false
        var cancelled = false
        let model = LinkSheetModel(
            store: store, tuneID: tuneID,
            resolve: { _ in
                started = true
                do {
                    try await Task.sleep(for: .seconds(60))
                } catch {
                    cancelled = true
                }
                return nil
            }, debounce: .zero)

        model.setURL("https://youtu.be/dQw4w9WgXcQ")
        try await eventually { started }
        model.cancel()
        try await eventually { cancelled }
        #expect(model.preview == nil)
    }

    @Test func savesOfflineUntitledWithTheDetectedProvider() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = LinkSheetModel(store: store, tuneID: tuneID, resolve: nil)

        model.setURL("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")
        #expect(await model.save())

        let row = try #require(try await links(store).first)
        #expect(row.provider == "spotify")
        #expect(row.providerRef == "track:4uLU6hMCjMI75M1A2tKUQC")
        #expect(row.title == nil)
        #expect(row.label == nil)
    }

    @Test func asksAtSaveWhenNothingWasLookedUpAndKeepsTheDetectedProviderForAnUnknownOne() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let resolver = FakeResolver()
        let url = "https://youtu.be/dQw4w9WgXcQ"
        resolver.answers[url] = ResolvedLink(provider: "napster", url: url, providerRef: "track:1", title: "Tune")
        let model = LinkSheetModel(store: store, tuneID: tuneID, resolve: resolver.resolve, debounce: .seconds(60))
        model.setURL(url)
        // A different link than the one typed forces the save to ask for itself.
        model.setURL("x")
        model.setURL(url)
        #expect(await model.save())

        let row = try #require(try await links(store).first)
        #expect(row.provider == "youtube")
        #expect(row.providerRef == "dQw4w9WgXcQ")
        #expect(row.title == "Tune")
    }

    @Test func refusesAnEmptyLinkOrOneThatIsNotAWebAddress() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = LinkSheetModel(store: store, tuneID: tuneID, resolve: nil)

        #expect(await model.save() == false)
        #expect(model.validation == LinkSheetModel.linkRequired)
        model.setURL("ftp://example.com/tune")
        #expect(model.validation == nil)
        #expect(await model.save() == false)
        #expect(model.validation == LinkSheetModel.linkNotWeb)
        #expect(try await links(store).isEmpty)
        #expect(!model.isSaved)
    }

    @Test func addsOnceWhenSavedTwice() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = LinkSheetModel(store: store, tuneID: tuneID, resolve: nil)
        model.setURL("https://example.com/tune")
        #expect(await model.save())
        #expect(await model.save() == false)
        #expect(try await links(store).count == 1)
    }

    @Test func reportsAFailedAdd() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = LinkSheetModel(store: store, tuneID: "missing", resolve: nil)
        model.setURL("https://example.com/tune")
        #expect(await model.save() == false)
        #expect(model.failure == CommandError.tuneNotFoundMessage)
        model.setURL("https://example.com/tune2")
        #expect(model.failure == nil)
    }

    @Test func holdsTypingADismissalWouldLose() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = LinkSheetModel(store: store, tuneID: tuneID, resolve: nil)
        #expect(!model.isEdited)
        model.setURL("h")
        #expect(model.isEdited)
    }
}
