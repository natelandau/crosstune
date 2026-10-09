import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneCommands
@testable import CrosstuneUI

@MainActor
@Suite struct ImportModelTests {
    private func seed(
        _ store: CrosstuneStore, titles: [String] = [], newTuneGenre: String? = nil,
        newTuneStatus: String = UserSettings.defaultNewTuneStatus
    ) async throws {
        try await store.write { writer in
            try writer.put(
                UserSettings(
                    id: settingsID(clerkUserID: store.userID), createdAt: noon, audioQuality: "standard",
                    instruments: ["violin"], newTuneGenre: newTuneGenre, newTuneStatus: newTuneStatus), at: noon)
            for title in titles {
                let tune = Tune(id: UUID().uuidString, createdAt: noon, title: title)
                try writer.put(tune, at: noon)
                try writer.put(UserTune(createdAt: noon, tuneID: tune.id, status: "known"), at: noon)
            }
        }
    }

    private func opened(
        _ store: CrosstuneStore, analytics: AnalyticsClient = .noop, entry: ImportEntry = .settings
    ) async -> ImportModel {
        let model = ImportModel(store: store, analytics: analytics, entry: entry)
        await model.load()
        return model
    }

    /// Every live tune's title with its user tune's status, title order.
    private func stored(_ store: CrosstuneStore) async throws -> [(title: String, genre: String?, status: String)] {
        try await store.read { db in
            let tunes = try Tune.filter(Tune.CodingKeys.deletedAt == nil).fetchAll(db)
            let userTunes = try UserTune.fetchAll(db)
            return tunes.compactMap { tune in
                userTunes.first { $0.tuneID == tune.id }.map { (tune.title, tune.genre, $0.status) }
            }
            .sorted { $0.0 < $1.0 }
        }
    }

    @Test func continueReadsThePasteAndLeavesDuplicatesUnchecked() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, titles: ["Soldier's Joy"])
        let model = await opened(store)
        #expect(model.step == .paste)
        #expect(!model.canContinue)

        model.text = "- soldier's joy\n1. Cluck Old Hen\nReels:\nRed Haired Boy"
        #expect(model.canContinue)
        await model.continueToReview()

        #expect(model.step == .review)
        let rows = try #require(model.review?.rows)
        #expect(rows.map(\.title) == ["soldier's joy", "Cluck Old Hen", "Red Haired Boy"])
        #expect(rows.map(\.duplicate) == [true, false, false])
        #expect(rows.map(\.included) == [false, true, true])
        #expect(model.count == 2)
        #expect(model.addLabel == ImportCopy.addTunes(2))
    }

    @Test func editingATitleFollowsTheCatalogWithoutChangingTheCheck() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, titles: ["Soldier's Joy"])
        let model = await opened(store)
        model.text = "Cluck Old Hen\n" + String(repeating: "x", count: 210)
        await model.continueToReview()
        #expect(model.review?.rows[1].warnings == [.shortened])

        model.setTitle("Soldier's Joy", row: 0)
        #expect(model.review?.rows[0].duplicate == true)
        #expect(model.review?.rows[0].included == true)
        model.setTitle("Sally Goodin", row: 0)
        #expect(model.review?.rows[0].duplicate == false)

        model.setTitle("Shorter", row: 1)
        #expect(model.review?.rows[1].warnings == [])
    }

    @Test func addWritesTheCheckedRowsWithTheSettingsStatusAndGenre() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, titles: ["Soldier's Joy"], newTuneGenre: " Old-time ", newTuneStatus: "learning")
        let model = await opened(store)
        #expect(model.status == "learning")
        #expect(model.genre == "Old-time")

        model.text = "Soldier's Joy\nCluck Old Hen\nRed Haired Boy"
        await model.continueToReview()
        model.armAdd()
        let added = try await model.add()

        #expect(added == 2)
        let tunes = try await stored(store)
        #expect(tunes.map(\.title) == ["Cluck Old Hen", "Red Haired Boy", "Soldier's Joy"])
        #expect(tunes.filter { $0.title != "Soldier's Joy" }.allSatisfy { $0.genre == "Old-time" })
        #expect(tunes.filter { $0.title != "Soldier's Joy" }.allSatisfy { $0.status == "learning" })
    }

    @Test func aBlankTitleIsNeverAddedOrCounted() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Cluck Old Hen\nRed Haired Boy"
        await model.continueToReview()
        model.armAdd()

        model.setTitle("   ", row: 1)
        #expect(model.count == 1)
        let added = try await model.add()

        #expect(added == 1)
        #expect(try await stored(store).map(\.title) == ["Cluck Old Hen"])
    }

    @Test func nothingCheckedCannotBeAdded() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Cluck Old Hen"
        await model.continueToReview()
        model.armAdd()

        model.setIncluded(false, row: 0)
        #expect(model.count == 0)
        #expect(!model.canAdd)
        #expect(model.addLabel == ImportCopy.addTunes(0))
    }

    @Test func theReviewTakesNoAddUntilItIsArmed() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Cluck Old Hen"
        await model.continueToReview()

        #expect(!model.canAdd)
        #expect(try await model.add() == 0)
        #expect(try await stored(store).isEmpty)

        model.armAdd()
        #expect(model.canAdd)
        model.back()
        await model.continueToReview()
        #expect(!model.canAdd)
    }

    @Test func aSecondContinueOnTheReviewDoesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Cluck Old Hen"
        await model.continueToReview()

        #expect(!model.canContinue)
    }

    @Test func backThenContinueKeepsTheReviewWhenTheTextIsUnchanged() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let sink = RecordingAnalyticsSink()
        let model = await opened(store, analytics: sink.client)
        model.text = "Cluck Old Hen\nRed Haired Boy"
        await model.continueToReview()
        model.setTitle("Cluck Old Hen (A)", row: 0)
        model.setIncluded(false, row: 1)

        model.back()
        await model.continueToReview()

        #expect(model.step == .review)
        #expect(model.review?.rows.map(\.title) == ["Cluck Old Hen (A)", "Red Haired Boy"])
        #expect(model.review?.rows.map(\.included) == [true, false])
        #expect(sink.captures.filter { $0.name == "import_reviewed" }.count == 1)
    }

    @Test func aKeptReviewMarksATuneAddedSinceAsADuplicate() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Cluck Old Hen"
        await model.continueToReview()
        #expect(model.review?.rows[0].duplicate == false)

        model.back()
        try await seed(store, titles: ["Cluck Old Hen"])
        await model.continueToReview()

        #expect(model.review?.rows[0].duplicate == true)
        #expect(model.review?.rows[0].included == true)
        model.setTitle("Sally Goodin", row: 0)
        model.setTitle("Cluck Old Hen", row: 0)
        #expect(model.review?.rows[0].duplicate == true)
    }

    @Test func backThenContinueReadsTheTextAgain() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Cluck Old Hen"
        await model.continueToReview()
        model.setTitle("Edited", row: 0)

        model.back()
        #expect(model.step == .paste)
        model.text = "Cluck Old Hen\nSally Goodin"
        await model.continueToReview()

        #expect(model.review?.rows.map(\.title) == ["Cluck Old Hen", "Sally Goodin"])
    }

    @Test func aNewListTakesTheTunesAndReportsEveryStep() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, titles: ["Soldier's Joy"])
        let sink = RecordingAnalyticsSink()
        let model = await opened(store, analytics: sink.client, entry: .emptyCatalog)
        #expect(model.listName == ImportCopy.listName(on: .now))

        model.text = "Soldier's Joy\nCluck Old Hen\nRed Haired Boy"
        await model.continueToReview()
        model.setIncluded(false, row: 2)
        model.list = .new(name: "Fall jam")
        model.armAdd()
        let added = try await model.add()

        #expect(added == 1)
        let lists = try await store.read { db in try TuneList.fetchAll(db) }
        #expect(lists.map(\.name) == ["Fall jam"])
        let listID = try #require(lists.first?.id)
        #expect(
            sink.captures.map(\.name) == ["import_started", "import_reviewed", "list_created", "import_completed"])
        #expect(sink.captures[0].properties == ["entry": .string("empty_catalog")])
        #expect(
            sink.captures[1].properties == [
                "reader": .string("plain"), "count_bucket": .string(Bucket.count(3)),
                "duplicate_bucket": .string(Bucket.count(1)), "has_warnings": .bool(false),
            ])
        #expect(sink.captures[2].properties == ["list_id": .string(listID), "count_bucket": .string(Bucket.count(1))])
        #expect(
            sink.captures[3].properties == [
                "reader": .string("plain"), "count_bucket": .string(Bucket.count(1)),
                "skipped_bucket": .string(Bucket.count(2)), "list": .string("new"),
            ])
    }

    @Test func anExistingListTakesTheTunes() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let listID = try await store.write { writer in try writer.createList("Jam", at: noon) }
        let sink = RecordingAnalyticsSink()
        let model = await opened(store, analytics: sink.client)
        #expect(model.lists.map(\.name) == ["Jam"])

        model.text = "Cluck Old Hen"
        await model.continueToReview()
        model.list = .existing(listID: listID)
        model.armAdd()
        _ = try await model.add()

        #expect(sink.captures.map(\.name).contains("tunes_added_to_list"))
        #expect(sink.captures.last?.properties["list"] == .string("existing"))
    }

    @Test func aNewListNeedsAName() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Cluck Old Hen"
        await model.continueToReview()
        model.armAdd()

        model.list = .new(name: "  ")
        #expect(!model.canAdd)
    }

    @Test func anOpenedFileReplacesTheText() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Typed"
        let file = root.url.appending(path: "tunes.txt")
        try Data([0xEF, 0xBB, 0xBF] + Array("Cluck Old Hen\nSally Goodin".utf8)).write(to: file)

        await model.load(file: file)

        #expect(model.text == "Cluck Old Hen\nSally Goodin")
    }

    @Test func aDroppedTextFileReplacesTheText() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Typed"
        let file = root.url.appending(path: "tunes.txt")
        try Data("Cluck Old Hen".utf8).write(to: file)

        await model.load(dropped: [root.url.appending(path: "cover.png"), file])

        #expect(model.text == "Cluck Old Hen")
        #expect(model.failure == nil)
    }

    @Test func aDroppedFileThatIsNotTextSaysSoAndKeepsTheText() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Typed"

        await model.load(dropped: [root.url.appending(path: "tunes.pdf")])

        #expect(model.text == "Typed")
        #expect(model.failure == ImportCopy.textFilesOnly)
    }

    @Test func aFileThatIsNotTxtIsRefused() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Typed"
        for name in ["tunes.md", "tunes.csv"] {
            let file = root.url.appending(path: name)
            try Data("Cluck Old Hen".utf8).write(to: file)

            model.failure = nil
            await model.load(dropped: [file])
            #expect(model.failure == ImportCopy.textFilesOnly)
            model.failure = nil
            await model.load(file: file)
            #expect(model.failure == ImportCopy.textFilesOnly)
            #expect(model.text == "Typed")
        }
        let upper = root.url.appending(path: "TUNES.TXT")
        try Data("Sally Goodin".utf8).write(to: upper)
        await model.load(dropped: [upper])
        #expect(model.text == "Sally Goodin")
    }

    @Test func continueWaitsForTheOpening() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = ImportModel(store: store, analytics: .noop, entry: .settings)
        model.text = "Cluck Old Hen"
        #expect(!model.canContinue)

        await model.load()
        #expect(model.canContinue)
    }

    @Test func continueAndOpenWaitWhileAFileIsRead() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Typed"
        let gate = ReadGate()
        model.readFile = { _ in
            await gate.wait()
            return Data("Sally Goodin".utf8)
        }

        let reading = Task { await model.load(file: root.url.appending(path: "tunes.txt")) }
        // Opened on every way out, so a failed expectation never leaves the read waiting.
        defer { gate.open() }
        #expect(try await poll { gate.isWaiting })
        #expect(model.isReadingFile)
        #expect(!model.canContinue)
        #expect(!model.canOpenFile)

        gate.open()
        await reading.value
        #expect(model.text == "Sally Goodin")
        #expect(model.canContinue)
    }

    @Test func aSecondContinueWhileTheFirstReadsDoesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let sink = RecordingAnalyticsSink()
        let model = await opened(store, analytics: sink.client)
        model.text = "Cluck Old Hen"

        async let first: Void = model.continueToReview()
        async let second: Void = model.continueToReview()
        _ = await (first, second)

        #expect(sink.captures.filter { $0.name == "import_reviewed" }.count == 1)
        #expect(model.step == .review)
        #expect(!model.isReviewing)
    }

    @Test func aFileThatCannotBeReadSaysWhyAndKeepsTheText() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store)
        let model = await opened(store)
        model.text = "Typed"
        let missing = root.url.appending(path: "missing.txt")

        await model.load(file: missing)

        #expect(model.text == "Typed")
        #expect(model.failure != nil)
        #expect(!model.isReadingFile)
    }

    @Test func aRowsNoteNamesTheSourceTheDuplicateAndTheCut() {
        func row(_ title: String, source: String, duplicate: Bool = false, shortened: Bool = false) -> ImportRow {
            ImportRow(
                id: 0, title: title, source: source, duplicate: duplicate, included: true,
                warnings: shortened ? [.shortened] : [])
        }
        #expect(ImportSheet.note(row("Cluck Old Hen", source: "Cluck Old Hen")) == nil)
        #expect(ImportSheet.note(row("Cluck Old Hen", source: "- Cluck Old Hen")) == "- Cluck Old Hen")
        #expect(
            ImportSheet.note(row("Soldier's Joy", source: "Soldier's Joy", duplicate: true))
                == ImportCopy.alreadyInCatalog)
        // A blank title matches nothing, so the duplicate note goes with it.
        #expect(ImportSheet.note(row("  ", source: "Soldier's Joy", duplicate: true)) == "Soldier's Joy")
        #expect(
            ImportSheet.note(row("x", source: "xy", duplicate: true, shortened: true))
                == "xy · \(ImportCopy.alreadyInCatalog) · \(ImportCopy.shortenedNote)")
    }

    @Test func theCopyCountsTunesAndDatesTheListName() {
        #expect(ImportCopy.addTunes(1) == "Add 1 tune")
        #expect(ImportCopy.addedTunes(3) == "Added 3 tunes")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = Date(timeIntervalSince1970: 1_772_000_000)  // 2026-02-25 UTC
        #expect(ImportCopy.listName(on: date, calendar: calendar) == "Imported 2026-02-25")
    }

    /// The paste help is the public help page, so the rules live in one place.
    @Test func pasteHelpLinksToTheHelpPage() {
        #expect(ImportCopy.whatCanIPaste == "What can I paste?")
        #expect(ImportHelp.destination == URL(string: "https://crosstune.app/help/import"))
        #expect(ImportHelp.destination == ImportCopy.helpURL)
    }
}

/// Holds a file read until the test opens it.
@MainActor
private final class ReadGate {
    private var held: CheckedContinuation<Void, Never>?
    private var opened = false

    var isWaiting: Bool { held != nil }

    /// Returns at once once the gate has opened, so a read that starts late never waits forever.
    func wait() async {
        guard !opened else { return }
        await withCheckedContinuation { held = $0 }
    }

    func open() {
        opened = true
        held?.resume()
        held = nil
    }
}
