import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
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

        _ = try #require(await model.save())

        #expect(sink.captures == [.init(name: "list_created", properties: [:])])
    }

    @Test func reportsNothingForARenameOrAnEmptyName() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let list = SampleCatalog.lists[1]
        let rename = ListNameModel(
            store: store, target: .rename(listID: list.id, name: list.name), analytics: sink.client)
        rename.setName("Slow waltzes")
        _ = try #require(await rename.save())
        let empty = ListNameModel(store: store, target: .new, analytics: sink.client)
        #expect(await empty.save() == nil)

        #expect(sink.calls.isEmpty)
    }

    @Test func reportsTunesAddedToAListByThePicker() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = try await picker(store, titles: ["Soldier's Joy", "Tam Lin"])
        let waltzes = try #require(model.rows.first { $0.name == "Waltzes" })

        _ = try #require(await model.add(to: waltzes))

        #expect(sink.captures == [.init(name: "tunes_added_to_list", properties: ["count_bucket": .string("1-9")])])
    }

    @Test func reportsAListMadeWithItsTunes() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = try await picker(store, titles: ["Soldier's Joy", "Tam Lin"])
        model.newName = "Session favorites"

        _ = try #require(await model.create())

        #expect(
            sink.captures == [
                .init(name: "list_created", properties: [:]),
                .init(name: "tunes_added_to_list", properties: ["count_bucket": .string("1-9")]),
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

        #expect(sink.captures == [.init(name: "tunes_added_to_list", properties: ["count_bucket": .string("1-9")])])
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
                    properties: ["count_bucket": .string("1-9"), "fields_changed": .strings(["status"])])
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
                        "count_bucket": .string("1-9"), "fields_changed": .strings(["key", "tuning", "learned_from"]),
                    ])
            ])
    }

    @Test func reportsNothingForABulkArchive() async throws {
        let store = try await SampleCatalog.makeStore(root: root.url)
        let bulk = BulkActions(store: store, analytics: sink.client)

        #expect(await bulk.setArchived(true, [entry("Tam Lin")]))

        #expect(sink.calls.isEmpty)
    }
}
