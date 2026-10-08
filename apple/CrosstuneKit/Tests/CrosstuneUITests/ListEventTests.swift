import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

/// Lists and selections report once their write lands, with counts in buckets and field names
/// only.
@MainActor
@Suite struct ListEventTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private func entry(_ title: String) -> CatalogEntry {
        let entry = SampleCatalog.entries.first { $0.tune.title == title }!
        return CatalogEntry(tune: entry.tune, userTune: entry.userTune)
    }

    private func picker(_ store: CrosstuneStore, titles: [String]) async throws -> ListPickerModel {
        let model = ListPickerModel(
            store: store, userTuneIDs: titles.map { entry($0).userTune.id }, analytics: sink.client)
        #expect(try await poll { model.isLoaded && model.rows.allSatisfy { $0.note != nil } })
        return model
    }

    @Test func reportsAListNamedIntoBeing() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = ListNameModel(store: store, target: .new, analytics: sink.client)
        model.setName("Square dance set")

        let listID = try #require(await model.save())

        #expect(
            sink.captures == [
                .init(name: "list_created", properties: ["list_id": .string(listID), "count_bucket": .string("0")])
            ])
    }

    @Test func renamingAListReportsOnlyItsID() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let list = SampleCatalog.lists[1]
        let rename = ListNameModel(
            store: store, target: .rename(listID: list.id, name: list.name), analytics: sink.client)
        rename.setName("Slow waltzes")

        _ = try #require(await rename.save())

        #expect(sink.captures == [.init(name: "list_renamed", properties: ["list_id": .string(list.id)])])
        #expect(sink.captures.first?.properties.keys.sorted() == ["list_id"])
    }

    @Test func savingTheSameNameReportsNoRename() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let list = SampleCatalog.lists[1]
        let rename = ListNameModel(
            store: store, target: .rename(listID: list.id, name: list.name), analytics: sink.client)
        rename.setName("  \(list.name) ")

        #expect(await rename.save() == list.id)

        #expect(sink.captures.isEmpty)
    }

    @Test func reportsNothingForAnEmptyListName() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let empty = ListNameModel(store: store, target: .new, analytics: sink.client)
        #expect(await empty.save() == nil)

        #expect(sink.calls.isEmpty)
    }

    private func listModel(_ store: CrosstuneStore) async throws -> ListModel {
        let model = ListModel(store: store, listID: SampleCatalog.lists[0].id, analytics: sink.client)
        #expect(try await poll { model.list != nil && !model.rows.isEmpty })
        return model
    }

    @Test func removingATuneFromAListReportsTheCount() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = try await listModel(store)

        await model.remove(model.rows[0])

        #expect(
            sink.captures == [
                .init(
                    name: "tunes_removed_from_list",
                    properties: ["list_id": .string(SampleCatalog.lists[0].id), "count_bucket": .string("1-9")])
            ])
    }

    @Test func removingTunesFromAListInBulkReportsTheCount() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store, analytics: sink.client)
        let items = try await store.read { db in
            activeByPosition(
                try ListItem.filter(ListItem.CodingKeys.listID == SampleCatalog.lists[0].id).fetchAll(db)
            ).map(\.id)
        }

        #expect(
            await bulk.remove(
                itemIDs: Array(items.prefix(2)), from: "Tuesday session", listID: SampleCatalog.lists[0].id)
        )

        #expect(
            sink.captures == [
                .init(
                    name: "tunes_removed_from_list",
                    properties: ["list_id": .string(SampleCatalog.lists[0].id), "count_bucket": .string("1-9")])
            ])
    }

    @Test func deletingAListReportsItsIDAndSize() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = try await listModel(store)
        let size = model.entries.count

        #expect(await model.delete())

        #expect(
            sink.captures == [
                .init(
                    name: "list_deleted",
                    properties: [
                        "list_id": .string(SampleCatalog.lists[0].id),
                        "count_bucket": .string(Bucket.count(size)),
                    ])
            ])
    }

    @Test func reorderingAListReportsItsIDOnceTheMoveLands() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = try await listModel(store)

        model.move(from: 0, to: 1)

        #expect(
            try await poll {
                sink.captures == [
                    .init(name: "list_reordered", properties: ["list_id": .string(SampleCatalog.lists[0].id)])
                ]
            })
    }

    @Test func reportsTunesAddedToAListByThePicker() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = try await picker(store, titles: ["Soldier's Joy", "Tam Lin"])
        let waltzes = try #require(model.rows.first { $0.name == "Waltzes" })

        _ = try #require(await model.add(to: waltzes))

        #expect(
            sink.captures == [
                .init(
                    name: "tunes_added_to_list",
                    properties: ["list_id": .string(waltzes.id), "count_bucket": .string("1-9")])
            ])
    }

    /// The list starting with its tunes is one action, so it reports as one event.
    @Test func reportsAListMadeWithItsTunesOnlyAsCreated() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = try await picker(store, titles: ["Soldier's Joy", "Tam Lin"])
        model.newName = "Session favorites"

        let listID = try #require(await model.create()).listID

        #expect(
            sink.captures == [
                .init(name: "list_created", properties: ["list_id": .string(listID), "count_bucket": .string("1-9")])
            ])
    }

    @Test func reportsTheTunesPickedIntoAListOnceThePickerCloses() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = TunePickerModel(store: store, listID: SampleCatalog.lists[1].id, analytics: sink.client)
        #expect(try await poll { model.results != nil })

        await model.pick(entry("Soldier's Joy"))
        await model.pick(entry("Tam Lin"))
        #expect(sink.calls.isEmpty)
        model.close()

        #expect(
            sink.captures == [
                .init(
                    name: "tunes_added_to_list",
                    properties: ["list_id": .string(SampleCatalog.lists[1].id), "count_bucket": .string("1-9")])
            ])
    }

    @Test func reportsNothingForATunePickerClosedEmpty() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = TunePickerModel(store: store, listID: SampleCatalog.lists[1].id, analytics: sink.client)
        #expect(try await poll { model.results != nil })

        model.close()

        #expect(sink.calls.isEmpty)
    }

    @Test func reportsABulkStatusAsAnEditOfStatus() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store, analytics: sink.client)

        #expect(await bulk.setStatus("known", of: [entry("The Butterfly"), entry("Elzic's Farewell")]))

        #expect(
            sink.captures == [
                .init(
                    name: "bulk_edit_applied",
                    properties: [
                        "action": .string("status"), "count_bucket": .string("1-9"),
                        "fields_changed": .strings(["status"]),
                    ])
            ])
    }

    @Test func reportsTheFieldsABulkEditWrote() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store, analytics: sink.client)
        let patch = BatchEdit.patch([.key: .text("G"), .tuning("violin"): .text("AEAE"), .learnedFrom: .clear])

        #expect(await bulk.edit([entry("The Butterfly")], patch: patch))

        #expect(
            sink.captures == [
                .init(
                    name: "bulk_edit_applied",
                    properties: [
                        "action": .string("edit"), "count_bucket": .string("1-9"),
                        "fields_changed": .strings(["key", "tuning", "learned_from"]),
                    ])
            ])
    }

    @Test func reportsABulkArchiveAndUnarchive() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store, analytics: sink.client)

        #expect(await bulk.setArchived(true, [entry("Tam Lin")]))

        #expect(
            sink.captures == [
                .init(
                    name: "bulk_edit_applied",
                    properties: ["action": .string("archive"), "count_bucket": .string("1-9")])
            ])
    }

    @Test func reportsABulkDelete() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store, analytics: sink.client)
        let question = try #require(await bulk.deleteQuestion([entry("Tam Lin"), entry("The Butterfly")]))

        #expect(await bulk.delete(question))

        #expect(
            sink.captures == [
                .init(
                    name: "bulk_edit_applied",
                    properties: ["action": .string("delete"), "count_bucket": .string("1-9")])
            ])
    }
}
