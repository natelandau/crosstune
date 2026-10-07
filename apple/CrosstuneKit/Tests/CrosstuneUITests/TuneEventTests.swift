import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

/// The tune form reports a tune created or edited once its save lands, naming only which fields
/// changed and never what they hold.
@MainActor
@Suite struct TuneEventTests {
    private let sink = RecordingAnalyticsSink()

    private func seed(_ store: CrosstuneStore, tune: Tune? = nil, status: String = "want_to_learn") async throws {
        try await store.write { writer in
            try writer.put(
                UserSettings(
                    id: settingsID(clerkUserID: store.userID), createdAt: noon, audioQuality: "standard",
                    instruments: ["violin"]), at: noon)
            if let tune {
                try writer.put(tune, at: noon)
                try writer.put(UserTune(createdAt: noon, tuneID: tune.id, status: status), at: noon)
            }
        }
    }

    private func editing(_ store: CrosstuneStore, _ tune: Tune) async throws -> TuneFormModel {
        let userTuneID = try await store.read { db in
            try UserTune.filter(UserTune.CodingKeys.tuneID == tune.id).fetchOne(db)!.id
        }
        let model = TuneFormModel(
            store: store, target: .edit(tuneID: tune.id, userTuneID: userTuneID), analytics: sink.client)
        await model.load()
        return model
    }

    @Test func reportsATuneCreatedWithWhereItStartedAndWhetherItHasAKey() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(
            store: store, target: .new(title: "Angeline", source: .searchOffer), analytics: sink.client)
        await model.load()
        model.values.key = "D"

        _ = try #require(await model.save())

        #expect(
            sink.captures == [
                .init(
                    name: "tune_created",
                    properties: ["source": .string("search_offer"), "has_key": .bool(true), "has_tuning": .bool(false)])
            ])
    }

    @Test func reportsATuningOnANewTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(
            store: store, target: .new(title: nil, listID: nil, source: .list), analytics: sink.client)
        await model.load()
        model.setTitle("Sally Ann")
        model.values.tunings["violin"] = TuningValues(tuning: "AEAE")

        _ = try #require(await model.save())

        #expect(
            sink.captures == [
                .init(
                    name: "tune_created",
                    properties: ["source": .string("list"), "has_key": .bool(false), "has_tuning": .bool(true)])
            ])
    }

    @Test func reportsNothingForASaveThatDoesNotRun() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(store: store, target: .new(title: nil, source: .catalog), analytics: sink.client)
        await model.load()

        #expect(await model.save() == nil)

        #expect(sink.calls.isEmpty)
    }

    @Test func reportsOnlyTheNamesOfTheFieldsAnEditChanged() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let stored = Tune(id: "t1", createdAt: noon, title: "Sally Ann", key: "A")
        try await seed(store, tune: stored)
        let model = try await editing(store, stored)
        model.values.key = "D"
        model.values.notes = "From the Hammons family"

        _ = try #require(await model.save())

        #expect(
            sink.captures == [.init(name: "tune_edited", properties: ["fields_changed": .strings(["key", "notes"])])])
    }

    @Test func tellsATuningFromACapo() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let stored = Tune(id: "t1", createdAt: noon, title: "Sally Ann")
        try await seed(store, tune: stored)
        let model = try await editing(store, stored)
        model.values.tunings["guitar"] = TuningValues(tuning: "", capo: 2)

        _ = try #require(await model.save())

        #expect(sink.captures == [.init(name: "tune_edited", properties: ["fields_changed": .strings(["capo"])])])
    }

    @Test func reportsAStatusChangeWithBothStatuses() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let stored = Tune(id: "t1", createdAt: noon, title: "Sally Ann")
        try await seed(store, tune: stored, status: "learning")
        let model = try await editing(store, stored)
        model.values.status = "known"

        _ = try #require(await model.save())

        #expect(
            sink.captures == [
                .init(name: "tune_edited", properties: ["fields_changed": .strings(["status"])]),
                .init(name: "tune_status_changed", properties: ["from": .string("learning"), "to": .string("known")]),
            ])
    }

    @Test func reportsNothingForAnEditThatChangesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let stored = Tune(id: "t1", createdAt: noon, title: "Sally Ann")
        try await seed(store, tune: stored)
        let model = try await editing(store, stored)

        _ = try #require(await model.save())

        #expect(sink.calls.isEmpty)
    }
}
