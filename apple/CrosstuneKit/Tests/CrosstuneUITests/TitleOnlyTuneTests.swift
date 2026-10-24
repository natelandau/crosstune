import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

/// A tune made from its title alone: the New tunes settings seed it, a list or recording it is
/// filed into never costs the tune, and the Added banner's Undo never deletes work.
@MainActor
@Suite struct TitleOnlyTuneTests {
    private let sink = RecordingAnalyticsSink()
    /// Held for the test, since the store's folder goes with it.
    private let root = TemporaryRoot()

    private func seeded(genre: String? = nil, status: String = UserSettings.defaultNewTuneStatus) async throws
        -> CrosstuneStore
    {
        let store = try root.open()
        try await store.write { writer in
            try writer.put(
                UserSettings(
                    id: settingsID(clerkUserID: store.userID), createdAt: noon, audioQuality: "standard",
                    instruments: ["violin"], newTuneGenre: genre, newTuneStatus: status), at: noon)
            try writer.put(TuneList(id: "set", createdAt: noon, name: "Session"), at: noon)
            try writer.put(
                Recording(id: "take", tuneID: nil, source: "microphone", recordedAt: noon), at: noon)
        }
        return store
    }

    private func stored(_ store: CrosstuneStore, _ tuneID: String) async throws -> (Tune, UserTune)? {
        try await store.read { db in
            guard let tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil,
                let userTune = try UserTune.filter(UserTune.CodingKeys.tuneID == tuneID).fetchOne(db)
            else { return nil }
            return (tune, userTune)
        }
    }

    private func liveTuneCount(_ store: CrosstuneStore) async throws -> Int {
        try await store.read { db in try Tune.filter(Tune.CodingKeys.deletedAt == nil).fetchCount(db) }
    }

    // MARK: The create

    @Test func seedsStatusAndGenreFromTheNewTunesSettingsAndLeavesTheRestEmpty() async throws {
        let store = try await seeded(genre: " Old-time ", status: "learning")

        let created = try await Commands(store: store).createTitleOnly(
            title: "Angeline", source: .searchOffer, analytics: sink.client)

        let (tune, userTune) = try #require(try await stored(store, created.tuneID))
        #expect(tune.title == "Angeline")
        #expect(tune.genre == "Old-time")
        #expect(userTune.status == "learning")
        #expect(tune.key == nil && tune.timeSignature == nil && tune.tuneType == nil && tune.modes.isEmpty)
        #expect(userTune.notes == nil && tune.lyrics == nil)
        #expect(
            sink.captures == [
                .init(
                    name: "tune_created",
                    properties: [
                        "source": .string("search_offer"), "fields_set": .strings(["title", "status", "genre"]),
                        "tune_id": .string(created.tuneID),
                    ])
            ])
    }

    @Test func reportsOnlyTheTitleWhenTheSettingsSeedNothing() async throws {
        let store = try await seeded()

        let created = try await Commands(store: store).createTitleOnly(
            title: "Angeline", source: .list, listID: "set", analytics: sink.client)

        let (tune, userTune) = try #require(try await stored(store, created.tuneID))
        #expect(tune.genre == nil)
        #expect(userTune.status == UserSettings.defaultNewTuneStatus)
        #expect(sink.captures.first?.properties["fields_set"] == .strings(["title"]))
        #expect(sink.captures.first?.properties["source"] == .string("list"))
    }

    @Test func trimsCapsAndTrimsAgainAndTheBannerNamesTheStoredTitle() async throws {
        let store = try await seeded()
        let limit = Vocabulary.Limits.Tune.title
        // The cap lands just after a space, which the second trim takes off.
        let typed = "  " + String(repeating: "a", count: limit - 1) + " tail"
        let added = AddedTuneOffer(store: store, analytics: sink.client)

        let tuneID = try #require(await added.add(title: typed, source: .searchOffer))

        let (tune, _) = try #require(try await stored(store, tuneID))
        #expect(tune.title == String(repeating: "a", count: limit - 1))
        #expect(added.offer?.message == AddedTuneOffer.added(tune.title))
        #expect(added.offer?.undo != nil)
    }

    @Test func refusesABlankTitleAndCreatesNothing() async throws {
        let store = try await seeded()

        await #expect(throws: CommandError.tuneTitleRequired) {
            try await Commands(store: store).createTitleOnly(title: "   ", source: .list, analytics: sink.client)
        }
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        #expect(await added.add(title: " \n ", source: .searchOffer) == nil)

        #expect(try await liveTuneCount(store) == 0)
        #expect(added.offer?.undo == nil)
        #expect(sink.captures.isEmpty)
    }

    @Test func filesTheNewTuneIntoTheListAndUnderTheRecording() async throws {
        let store = try await seeded()

        let created = try await Commands(store: store).createTitleOnly(
            title: "Angeline", source: .recordingsList, listID: "set", recordingID: "take", analytics: sink.client)

        #expect(created.filingError == nil)
        let (listed, filedUnder) = try await store.read { db in
            (
                try ListItem.filter(ListItem.CodingKeys.listID == "set" && ListItem.CodingKeys.deletedAt == nil)
                    .fetchAll(db).map(\.userTuneID),
                try Recording.fetchOne(db, key: "take")?.tuneID
            )
        }
        #expect(listed == [created.userTuneID])
        #expect(filedUnder == created.tuneID)
        #expect(sink.captures.map(\.name) == ["tune_created", "recording_filed"])
    }

    @Test func aRefusedFilingStillCreatesTheTune() async throws {
        let store = try await seeded()

        let toList = try await Commands(store: store).createTitleOnly(
            title: "Angeline", source: .list, listID: "missing", analytics: sink.client)
        let underRecording = try await Commands(store: store).createTitleOnly(
            title: "Cluck Old Hen", source: .recordingsList, recordingID: "missing", analytics: sink.client)

        #expect(toList.filingError as? CommandError == .listNotFound)
        #expect(underRecording.filingError as? CommandError == .recordingNotFound)
        #expect(try await stored(store, toList.tuneID) != nil)
        #expect(try await stored(store, underRecording.tuneID) != nil)
        #expect(sink.captures.map(\.name) == ["tune_created", "tune_created"])
    }

    // MARK: What counts as work

    @Test func aTuneWithOnlyItsTitleHasNoWork() async throws {
        let store = try await seeded()
        let created = try await Commands(store: store).createTitleOnly(title: "Angeline", source: .list)
        #expect(try await Commands(store: store).tuneHasWork(tuneID: created.tuneID) == false)
    }

    @Test(arguments: Work.allCases)
    func eachKindOfAttachmentIsWork(_ work: Work) async throws {
        let store = try await seeded()
        let created = try await Commands(store: store).createTitleOnly(title: "Angeline", source: .list)

        try await work.attach(to: created, in: store)

        #expect(try await Commands(store: store).tuneHasWork(tuneID: created.tuneID))
    }

    @Test func blankNotesAndLyricsAndRemovedAttachmentsAreNotWork() async throws {
        let store = try await seeded()
        let created = try await Commands(store: store).createTitleOnly(title: "Angeline", source: .list)
        let commands = Commands(store: store)
        try await commands.updateUserTune(created.userTuneID, patch: UserTunePatch(notes: .value("  \n ")))
        try await commands.updateTune(created.tuneID, patch: TunePatch(lyrics: .value(" ")))
        let itemID = try await commands.addToList("set", userTuneID: created.userTuneID)
        try await commands.removeFromList(itemID)

        #expect(try await commands.tuneHasWork(tuneID: created.tuneID) == false)
    }

    // MARK: The Added banner

    @Test func undoDeletesATuneWithNothingAddedAndReportsTheDelete() async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))
        let undo = try #require(added.offer?.undo)

        undo()

        #expect(try await poll { try await stored(store, tuneID) == nil })
        #expect(try await poll { added.undone == tuneID })
        #expect(try await poll { sink.captures.map(\.name) == ["tune_created", "tune_deleted"] })
        #expect(
            sink.captures.last?.properties["recordings_count"]
                == AnalyticsEvent.tuneDeleted(
                    tuneID: tuneID, recordings: 0, links: 0, scans: 0
                ).properties["recordings_count"])
    }

    @Test(arguments: Work.allCases)
    func undoIsWithdrawnOnceWorkAttaches(_ work: Work) async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))
        let created = try #require(try await stored(store, tuneID))

        try await work.attach(
            to: CreatedTune(
                tuneID: tuneID, userTuneID: created.1.id, title: created.0.title,
                defaults: NewTuneDefaults(nil)),
            in: store)

        #expect(try await poll { added.offer != nil && added.offer?.undo == nil })
        #expect(added.offer?.message == AddedTuneOffer.added("Angeline"))
    }

    /// The musician leaves the page, something is added to the tune from
    /// elsewhere, and an Undo still on screen is pressed before the banner hears of it. The
    /// delete checks again inside its own transaction and keeps the tune.
    @Test(arguments: Work.allCases)
    func undoAfterWorkArrivesFromElsewhereKeepsTheTune(_ work: Work) async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))
        // The banner holds the offer it drew, Undo and all, whatever the model does after.
        let undo = try #require(added.offer?.undo)
        let created = try #require(try await stored(store, tuneID))

        try await work.attach(
            to: CreatedTune(
                tuneID: tuneID, userTuneID: created.1.id, title: created.0.title,
                defaults: NewTuneDefaults(nil)),
            in: store)
        undo()

        #expect(try await poll { added.offer?.message == AddedTuneOffer.kept("Angeline") })
        #expect(added.offer?.undo == nil)
        #expect(try await stored(store, tuneID) != nil)
        #expect(added.undone == nil)
        #expect(!sink.captures.map(\.name).contains("tune_deleted"))
    }

    @Test func systemUndoCarriesTheSameUndoAndLeavesWithTheBanners() async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let undoManager = UndoManager()
        added.undoManager = undoManager
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))
        #expect(undoManager.canUndo)
        #expect(undoManager.undoActionName == AddedTuneOffer.undoActionName)

        undoManager.undo()

        #expect(added.offer == nil)
        #expect(try await poll { try await stored(store, tuneID) == nil })
        #expect(!undoManager.canUndo)
    }

    @Test func systemUndoIsWithdrawnWithTheBannersOnceWorkAttaches() async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let undoManager = UndoManager()
        added.undoManager = undoManager
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))
        let created = try #require(try await stored(store, tuneID))

        try await Work.notes.attach(
            to: CreatedTune(
                tuneID: tuneID, userTuneID: created.1.id, title: created.0.title, defaults: NewTuneDefaults(nil)),
            in: store)

        #expect(try await poll { added.offer?.undo == nil })
        #expect(!undoManager.canUndo)
    }

    @Test func theBannersUndoTakesTheSystemUndoWithIt() async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let undoManager = UndoManager()
        added.undoManager = undoManager
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))
        // A press is a later event than the add, whose undo group has closed by then.
        #expect(try await poll { undoManager.groupingLevel == 0 })

        added.offer?.undo?()

        #expect(try await poll { try await stored(store, tuneID) == nil })
        #expect(!undoManager.canUndo)
    }

    @Test func anUndoOnATuneAlreadyDeletedReportsNothingMore() async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))

        await added.undo(tuneID: tuneID, title: "Angeline", pressedAt: added.shownCount)
        await added.undo(tuneID: tuneID, title: "Angeline", pressedAt: added.shownCount)

        #expect(sink.captures.map(\.name) == ["tune_created", "tune_deleted"])
        #expect(added.offer?.message != AddedTuneOffer.kept("Angeline"))
    }

    @Test func aTuneDeletedElsewhereWithdrawsUndoAndItsUndoDoesNothing() async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let undoManager = UndoManager()
        added.undoManager = undoManager
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))

        try await Commands(store: store).deleteTune(tuneID)

        #expect(try await poll { added.offer != nil && added.offer?.undo == nil })
        #expect(!undoManager.canUndo)
        await added.undo(tuneID: tuneID, title: "Angeline", pressedAt: added.shownCount)
        #expect(added.offer?.message == AddedTuneOffer.added("Angeline"))
        #expect(added.undone == nil)
        #expect(sink.captures.map(\.name) == ["tune_created"])
    }

    @Test func aBannerThatTimesOutTakesItsSystemUndoWithIt() async throws {
        let store = try await seeded()
        let deadline = Deadline()
        let added = AddedTuneOffer(store: store, analytics: sink.client, waitOut: { _ in await deadline.wait() })
        let undoManager = UndoManager()
        added.undoManager = undoManager
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))
        #expect(undoManager.canUndo)
        // The time runs out in a later event than the add, whose undo group has closed by then.
        #expect(try await poll { undoManager.groupingLevel == 0 && deadline.started == 1 })

        deadline.pass()

        #expect(try await poll { added.offer == nil })
        #expect(!undoManager.canUndo)
        #expect(try await stored(store, tuneID) != nil)
    }

    @Test func aKeptUndoLeavesANewerBannerAndItsUndo() async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let first = try #require(await added.add(title: "Angeline", source: .searchOffer))
        let created = try #require(try await stored(store, first))
        try await Work.notes.attach(
            to: CreatedTune(
                tuneID: first, userTuneID: created.1.id, title: created.0.title, defaults: NewTuneDefaults(nil)),
            in: store)
        // Pressed on the first banner, landing once the second is up.
        let pressedAt = added.shownCount
        _ = try #require(await added.add(title: "Cluck Old Hen", source: .searchOffer))

        await added.undo(tuneID: first, title: "Angeline", pressedAt: pressedAt)

        #expect(added.offer?.message == AddedTuneOffer.added("Cluck Old Hen"))
        #expect(added.offer?.undo != nil)
        #expect(try await stored(store, first) != nil)
    }

    @Test func aNoticeWaitsForTheBannerWhoseUndoIsOnShow() async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))
        let created = try #require(try await stored(store, tuneID))

        added.notify(AddToTuneModel.failed)
        #expect(added.offer?.message == AddedTuneOffer.added("Angeline"))
        #expect(added.offer?.undo != nil)

        try await Work.notes.attach(
            to: CreatedTune(
                tuneID: tuneID, userTuneID: created.1.id, title: created.0.title, defaults: NewTuneDefaults(nil)),
            in: store)
        #expect(try await poll { added.offer?.message == AddToTuneModel.failed })
        #expect(added.offer?.undo == nil)
    }

    @Test func noticesShowFirstInFirstOut() async throws {
        let store = try await seeded()
        let deadline = Deadline()
        let added = AddedTuneOffer(store: store, analytics: sink.client, waitOut: { _ in await deadline.wait() })
        let tuneID = try #require(await added.add(title: "Angeline", source: .searchOffer))
        let created = try #require(try await stored(store, tuneID))
        added.notify("first")
        added.notify("second")

        try await Work.notes.attach(
            to: CreatedTune(
                tuneID: tuneID, userTuneID: created.1.id, title: created.0.title, defaults: NewTuneDefaults(nil)),
            in: store)
        #expect(try await poll { added.offer?.message == "first" })
        // A notice arriving while others wait joins the end, rather than replacing the one on show.
        added.notify("third")
        #expect(added.offer?.message == "first")

        // Each banner's wait has begun before its time is passed: the Added one, then each notice.
        #expect(try await poll { deadline.started == 2 })
        deadline.pass()
        #expect(try await poll { added.offer?.message == "second" && deadline.started == 3 })
        deadline.pass()
        #expect(try await poll { added.offer?.message == "third" && deadline.started == 4 })
        deadline.pass()
        #expect(try await poll { added.offer == nil })
    }

    @Test func aSecondAddWhileOneRunsCreatesNothingMore() async throws {
        let store = try await seeded()
        let added = AddedTuneOffer(store: store, analytics: sink.client)

        async let first = added.add(title: "Angeline", source: .searchOffer)
        async let second = added.add(title: "Angeline", source: .searchOffer)
        let ids = await [first, second].compactMap(\.self)

        #expect(ids.count == 1)
        #expect(try await liveTuneCount(store) == 1)
    }

    // MARK: The list picker

    @Test func thePickerCreatesIntoItsListAndMarksTheNewRow() async throws {
        let store = try await seeded()
        let model = TunePickerModel(store: store, listID: "set", analytics: sink.client)
        model.query = "Angeline"
        #expect(try await poll { model.results?.outcome.title == "Angeline" })

        await model.create("Angeline")

        #expect(model.failure == nil)
        #expect(
            try await poll {
                model.results?.rows.contains { $0.entry.tune.title == "Angeline" && $0.isTaken } == true
            })
        #expect(sink.captures.map(\.name) == ["tune_created"])
        #expect(sink.captures.first?.properties["source"] == .string("list"))
    }

    @Test func thePickerShowsARefusedListButKeepsTheTune() async throws {
        let store = try await seeded()
        let model = TunePickerModel(store: store, listID: "missing", analytics: sink.client)

        await model.create("Angeline")

        #expect(model.failure == CommandError.listNotFoundMessage)
        #expect(try await liveTuneCount(store) == 1)
    }
}

/// Something added to a tune that its Undo must never delete.
enum Work: CaseIterable, Sendable {
    case recording, link, scan, listEntry, notes, lyrics

    func attach(to created: CreatedTune, in store: CrosstuneStore) async throws {
        let commands = Commands(store: store)
        switch self {
        case .recording:
            try await commands.updateRecording("take", tuneID: .value(created.tuneID))
        case .link:
            try await store.write { writer in
                try writer.put(
                    RecordingLink(tuneID: created.tuneID, url: "https://example.com/a", provider: "other"), at: noon)
            }
        case .scan:
            try await store.write { writer in
                try writer.put(ScanRecord(tuneID: created.tuneID, width: 600, height: 800), at: noon)
            }
        case .listEntry:
            _ = try await commands.addToList("set", userTuneID: created.userTuneID)
        case .notes:
            try await commands.updateUserTune(created.userTuneID, patch: UserTunePatch(notes: .value("Slow A part")))
        case .lyrics:
            try await commands.updateTune(created.tuneID, patch: TunePatch(lyrics: .value("Angeline the baker")))
        }
    }
}

/// A banner deadline the test passes by hand, so no test waits a fixed time for a banner to leave.
@MainActor
private final class Deadline {
    private var waiting: [CheckedContinuation<Void, Never>] = []
    /// How many banners have started their wait, one per banner shown.
    private(set) var started = 0

    func wait() async {
        started += 1
        await withCheckedContinuation { waiting.append($0) }
    }

    /// Ends every banner's wait; a banner already replaced ignores it.
    func pass() {
        let ended = waiting
        waiting = []
        for continuation in ended { continuation.resume() }
    }
}
