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

    @Test func reportsATuneCreatedWithWhereItStartedAndTheFieldsSet() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(
            store: store, target: .new(title: "Angeline", source: .searchOffer), analytics: sink.client)
        await model.load()
        model.values.key = "D"

        let tuneID = try #require(await model.save())

        #expect(
            sink.captures == [
                .init(
                    name: "tune_created",
                    properties: [
                        "source": .string("search_offer"), "fields_set": .strings(["title", "key"]),
                        "tune_id": .string(tuneID),
                    ])
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

        let tuneID = try #require(await model.save())

        #expect(
            sink.captures == [
                .init(
                    name: "tune_created",
                    properties: [
                        "source": .string("list"), "fields_set": .strings(["title", "tuning"]),
                        "tune_id": .string(tuneID),
                    ])
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
            sink.captures == [
                .init(
                    name: "tune_edited",
                    properties: ["fields_changed": .strings(["key", "notes"]), "tune_id": .string("t1")])
            ])
    }

    @Test func tellsATuningFromACapo() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let stored = Tune(id: "t1", createdAt: noon, title: "Sally Ann")
        try await seed(store, tune: stored)
        let model = try await editing(store, stored)
        model.values.tunings["guitar"] = TuningValues(tuning: "", capo: 2)

        _ = try #require(await model.save())

        #expect(
            sink.captures == [
                .init(
                    name: "tune_edited", properties: ["fields_changed": .strings(["capo"]), "tune_id": .string("t1")])
            ])
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
                .init(
                    name: "tune_edited", properties: ["fields_changed": .strings(["status"]), "tune_id": .string("t1")]),
                .init(
                    name: "tune_status_changed",
                    properties: ["from": .string("learning"), "to": .string("known"), "tune_id": .string("t1")]),
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

    @Test func creatingATuneReportsTheFieldsSetAndItsID() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = TuneFormModel(
            store: store, target: .new(title: "Angeline", source: .catalog), analytics: sink.client)
        await model.load()
        model.values.lyrics = "Angeline the baker"
        model.values.key = "D"

        let tuneID = try #require(await model.save())

        #expect(
            sink.captures == [
                .init(
                    name: "tune_created",
                    properties: [
                        "source": .string("catalog"), "fields_set": .strings(["title", "key", "lyrics"]),
                        "tune_id": .string(tuneID),
                    ])
            ])
    }

    private func shown(_ store: CrosstuneStore, tuneID: String) async throws -> TuneModel {
        let model = TuneModel(store: store, tuneID: tuneID, analytics: sink.client)
        #expect(try await poll { model.shown != nil })
        return model
    }

    @Test func archivingAndUnarchivingReportEach() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, tune: Tune(id: "t1", createdAt: noon, title: "Sally Ann"))
        let model = try await shown(store, tuneID: "t1")

        await model.setArchived(true)
        await model.setArchived(false)

        #expect(
            sink.captures == [
                .init(name: "tune_archived", properties: ["tune_id": .string("t1")]),
                .init(name: "tune_unarchived", properties: ["tune_id": .string("t1")]),
            ])
    }

    @Test func deletingATuneReportsWhatWentWithIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, tune: Tune(id: "t1", createdAt: noon, title: "Sally Ann"))
        try await store.write { writer in
            for id in ["r1", "r2"] {
                try writer.put(
                    Recording(id: id, createdAt: noon, tuneID: "t1", source: "microphone", addedAt: noon, label: id),
                    at: noon)
            }
            try writer.put(ScanRecord(id: "p1", createdAt: noon, tuneID: "t1", width: 600, height: 800), at: noon)
        }
        let model = try await shown(store, tuneID: "t1")

        #expect(await model.delete())

        #expect(
            sink.captures == [
                .init(
                    name: "tune_deleted",
                    properties: [
                        "tune_id": .string("t1"), "recordings_count": .string("1-9"), "links_count": .string("0"),
                        "scans_count": .string("1-9"),
                    ])
            ])
    }

    @Test func anArchiveWhoseWriteFailsReportsNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, tune: Tune(id: "t1", createdAt: noon, title: "Sally Ann"))
        let model = try await shown(store, tuneID: "t1")
        try store.close()

        await model.setArchived(true)

        #expect(model.failure != nil)
        #expect(sink.calls.isEmpty)
    }

    /// The counts are required, so a delete whose counts could not be read is not reported
    /// rather than reported with made-up ones.
    @Test func aDeleteWhoseCountsWereNotReadReportsNothing() {
        struct ReadFailed: Error {}

        #expect(TuneModel.deletedEvent(tuneID: "t1", counts: .failure(ReadFailed())) == nil)
        #expect(
            TuneModel.deletedEvent(tuneID: "t1", counts: .success((recordings: 2, links: 0, scans: 1)))
                == .tuneDeleted(tuneID: "t1", recordings: 2, links: 0, scans: 1))
    }
}
