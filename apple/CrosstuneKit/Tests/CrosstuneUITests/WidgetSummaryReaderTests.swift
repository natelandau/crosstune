import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import CrosstuneWidgetData
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

/// The widget summary shows the newest recordings and every list as the app's screens order them.
@MainActor
@Suite struct WidgetSummaryReaderTests {
    private let root = TemporaryRoot()

    private struct CatalogPart {
        let recordings: [WidgetRecording]
        let lists: [WidgetList]
        let tunerReferenceLabel: String?
    }

    private func catalogPart(_ store: CrosstuneStore) async throws -> CatalogPart {
        let settingsRow = settingsID(clerkUserID: store.userID)
        return try await store.read { db in
            let listsPart = try WidgetSummaryReader.listsPart(db, settingsRow: settingsRow)
            return CatalogPart(
                recordings: try WidgetSummaryReader.newestRecordings(db), lists: listsPart.lists,
                tunerReferenceLabel: listsPart.tunerReferenceLabel)
        }
    }

    private func putRecording(
        _ store: CrosstuneStore, _ id: String, tuneID: String? = nil, label: String? = nil, recordedAt: Timestamp?,
        precision: RecordingPrecision = .time, durationMs: Int64? = nil
    ) async throws {
        var recording = Recording(
            id: id, tuneID: tuneID, source: "microphone", addedAt: noon, recordedAt: recordedAt,
            recordedPrecision: recordedAt == nil ? nil : precision.rawValue, state: "ready")
        recording.label = label
        recording.durationMs = durationMs
        let draft = recording
        try await store.write { writer in try writer.put(draft, at: noon) }
    }

    @Test func newestRecordingsComeFirstAndStopAtTheLimit() async throws {
        let store = try root.open()
        for minute in 1...7 {
            try await putRecording(store, "r\(minute)", recordedAt: later(Int64(minute) * 60_000))
        }

        let part = try await catalogPart(store)

        #expect(part.recordings.map(\.id) == ["r7", "r6", "r5", "r4", "r3"])
    }

    @Test func aRecordingWithNoTuneIsUnfiledAndUsesItsName() async throws {
        let store = try root.open()
        let tune = try await Commands(store: store).createTitleOnly(title: "Drowsy Maggie")
        try await putRecording(store, "filed", tuneID: tune.tuneID, recordedAt: later(60_000))
        try await putRecording(store, "unfiled", label: "Warm-up", recordedAt: noon)

        let part = try await catalogPart(store)

        #expect(
            part.recordings.map { [$0.title, "\($0.isUnfiled)"] } == [
                ["Drowsy Maggie", "false"], ["Warm-up", "true"],
            ])
    }

    @Test func aFiledRecordingWithANameShowsItsNameAsTheRecordingsListDoes() async throws {
        let store = try root.open()
        let tune = try await Commands(store: store).createTitleOnly(title: "Drowsy Maggie")
        try await putRecording(store, "named", tuneID: tune.tuneID, label: "At the session", recordedAt: noon)

        let recording = try #require(try await catalogPart(store).recordings.first)

        #expect(recording.title == "At the session")
        #expect(recording.isUnfiled == false)
    }

    /// The widget words a partial date as far as it is known, and an unknown one as the day added.
    @Test(
        arguments: [
            (
                Optional(Timestamp(milliseconds: 0)), RecordingPrecision.year, RecordingPrecision.year,
                Timestamp(milliseconds: 0)
            ),
            (nil, .year, .time, noon),
        ] as [(Timestamp?, RecordingPrecision, RecordingPrecision, Timestamp)])
    func aRecordingCarriesItsDateAndHowMuchOfItIsKnown(
        recordedAt: Timestamp?, precision: RecordingPrecision, shownPrecision: RecordingPrecision, shownAt: Timestamp
    ) async throws {
        let store = try root.open()
        try await putRecording(store, "r", recordedAt: recordedAt, precision: precision)

        let recording = try #require(try await catalogPart(store).recordings.first)

        #expect(recording.recordedPrecision == shownPrecision)
        #expect(recording.recordedAt == shownAt.date)
    }

    @Test(arguments: [false, true])
    func archivedTunesShowOnlyUnderTheListsShowArchivedSetting(showArchived: Bool) async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let kept = try await commands.createTitleOnly(title: "Drowsy Maggie")
        let archived = try await commands.createTitleOnly(title: "The Silver Spear")
        _ = try await commands.createListWithTunes(
            name: "Session", userTuneIDs: [kept.userTuneID, archived.userTuneID])
        try await commands.setArchivedMany([archived.userTuneID], archived: true)
        try await store.setMeta(.listShowArchived, to: showArchived)

        let part = try await catalogPart(store)

        #expect(
            part.lists.first?.tunes.map(\.id) == (showArchived ? [kept.tuneID, archived.tuneID] : [kept.tuneID]))
    }

    @Test func deletedRecordingsListsAndTunesAreLeftOut() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let kept = try await commands.createTitleOnly(title: "Drowsy Maggie")
        let deleted = try await commands.createTitleOnly(title: "The Silver Spear")
        let list = try await commands.createListWithTunes(
            name: "Session", userTuneIDs: [kept.userTuneID, deleted.userTuneID])
        let deletedList = try await commands.createList("Old")
        try await putRecording(store, "kept", recordedAt: noon)
        try await putRecording(store, "gone", recordedAt: later(60_000))
        try await commands.deleteRecording("gone")
        try await commands.deleteTunes([deleted.userTuneID])
        try await commands.deleteList(deletedList)

        let part = try await catalogPart(store)

        #expect(part.recordings.map(\.id) == ["kept"])
        #expect(part.lists.map(\.id) == [list])
        #expect(part.lists.first?.tunes.map(\.id) == [kept.tuneID])
    }

    @Test func listsKeepTheMusiciansOrderAndTunesKeepListOrder() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let first = try await commands.createTitleOnly(title: "The Silver Spear")
        let second = try await commands.createTitleOnly(title: "Drowsy Maggie")
        let session = try await commands.createListWithTunes(
            name: "Session", userTuneIDs: [first.userTuneID, second.userTuneID])
        let practice = try await commands.createList("Practice")
        let practiceItem = try await commands.addToList(practice, userTuneID: first.userTuneID)
        let secondItem = try await commands.addToList(practice, userTuneID: second.userTuneID)
        try await commands.moveItem(listID: practice, itemID: secondItem, targetID: practiceItem)

        let part = try await catalogPart(store)

        #expect(part.lists.map(\.id) == [session, practice])
        #expect(part.lists.first { $0.id == session }?.tunes.map(\.id) == [first.tuneID, second.tuneID])
        #expect(part.lists.first { $0.id == practice }?.tunes.map(\.id) == [second.tuneID, first.tuneID])
    }

    @Test(arguments: [(UserSettings.defaultTunerA4Hz, false), (442, true)])
    func theTunersReferencePitchShowsOnlyWhenNotStandard(hz: Int, shown: Bool) async throws {
        let store = try root.open()
        try await Commands(store: store).setTunerA4Hz(clerkUserID: store.userID, hz: hz)

        let part = try await catalogPart(store)

        #expect((part.tunerReferenceLabel != nil) == shown)
    }

    /// An unknown length stays unknown, so the widget leaves it out rather than showing 0:00.
    @Test(arguments: [(Int64?.some(93_000), TimeInterval?.some(93)), (nil, nil)])
    func aRecordingCarriesItsLengthOnlyWhenKnown(durationMs: Int64?, duration: TimeInterval?) async throws {
        let store = try root.open()
        try await putRecording(store, "r", recordedAt: noon, durationMs: durationMs)

        let recording = try #require(try await catalogPart(store).recordings.first)

        #expect(recording.duration == duration)
    }

    /// The lists part has an observation of its own, so a recording or link change must not
    /// read every list again.
    @Test(arguments: ["recordings", "recording_links", "recording_files"])
    func listsReadNoRecordingTable(table: String) async throws {
        let store = try root.open()
        let settingsRow = settingsID(clerkUserID: store.userID)
        let statements = try await store.read { db in
            let log = StatementLog()
            db.trace(options: .statement) { log.sql.append("\($0)") }
            defer { db.trace(options: []) }
            _ = try WidgetSummaryReader.listsPart(db, settingsRow: settingsRow)
            return log.sql
        }
        #expect(!statements.isEmpty)
        #expect(statements.allSatisfy { !$0.contains(table) })
    }
}

private final class StatementLog: @unchecked Sendable {
    var sql: [String] = []
}
