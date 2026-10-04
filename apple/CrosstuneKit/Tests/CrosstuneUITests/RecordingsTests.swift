@preconcurrency import AVFoundation
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: () async throws -> Bool) async throws {
    if try await poll({ try await condition() }) { return }
    Issue.record("The condition never held")
}

private func view(_ id: String, tune: String?, minutes: Int64) -> RecordingView {
    RecordingView(
        recording: Recording(
            id: id, tuneID: tune, source: "microphone", addedAt: later(minutes * 60_000), state: "ready"),
        file: nil, tuneID: tune, tuneTitle: tune.map { "Tune \($0)" })
}

private func putRecording(
    _ store: CrosstuneStore, _ id: String, tuneID: String? = nil, label: String? = nil, minutes: Int64 = 0,
    state: String = "ready", file: RecordingFile? = nil, origin: String = "own"
) async throws {
    var draft = Recording(
        id: id, tuneID: tuneID, source: "microphone", addedAt: later(minutes * 60_000), state: state)
    draft.label = label
    draft.origin = origin
    let recording = draft
    try await store.write { writer in
        try writer.put(recording, at: noon)
        try file?.upsert(writer.db)
    }
}

private let losAngeles = TimeZone(identifier: "America/Los_Angeles")!

private func putDated(_ store: CrosstuneStore, _ id: String, at: Timestamp, precision: String) async throws {
    let recording = Recording(
        id: id, tuneID: nil, source: "microphone", addedAt: noon, recordedAt: at, recordedPrecision: precision,
        state: "ready")
    try await store.write { writer in try writer.put(recording, at: noon) }
}

/// The filed recordings of an arrangement, in order, whether flat or under their tunes.
private func filedViews(_ arrangement: RecordingArrangement) -> [RecordingView] {
    switch arrangement.filed {
    case .flat(let views): views
    case .byTune(let tunes): tunes.flatMap(\.views)
    }
}

/// A server that answers nothing, so a download fetches no audio.
private struct RefusingSyncAPI: SyncAPI {
    func push(_ changes: [Change]) async throws -> [PushResult] { [] }
    func pull(since: Int64) async throws -> PullPage { PullPage(rows: [], nextSince: since, hasMore: false) }
    func storage() async throws -> StorageFigures { StorageFigures(usedBytes: 0, quotaBytes: 0, maxFileBytes: 0) }
    func resolveLink(url: String) async throws -> ResolvedLink { throw URLError(.badURL) }
    func searchRecordings(q: String, providers: [String], country: String) async throws -> SearchResponse {
        throw URLError(.badURL)
    }
    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
        throw URLError(.badURL)
    }
    func uploadFinished(recordingID: String) async throws { throw URLError(.badURL) }
    func downloadURL(recordingID: String) async throws -> DownloadURL { throw URLError(.badServerResponse) }
    func peaksURL(recordingID: String) async throws -> PeaksURL { throw URLError(.badServerResponse) }
    func retryRecording(recordingID: String) async throws { throw URLError(.badURL) }
    func notationUploadSlot(pageID: String, bytes: Int64) async throws -> SignedURL { throw URLError(.badURL) }
    func notationUploaded(pageID: String) async throws { throw URLError(.badURL) }
    func notationDownload(pageID: String) async throws -> SignedURL { throw URLError(.badURL) }
    func putObject(_ url: URL, file: URL, contentType: String) async throws { throw URLError(.badURL) }
    func getObject(_ url: URL, to destination: URL) async throws { throw URLError(.badURL) }
}

@Suite struct RecordingDeleteMessageTests {
    @Test func warnsThatARecordingNeverUploadedCannotComeBack() {
        let waiting = RecordingView(
            recording: Recording(id: "r", tuneID: nil, source: "microphone", addedAt: noon, state: "pending_upload"),
            file: RecordingFile(id: "r", localState: .captured), tuneID: nil, tuneTitle: nil)
        #expect(RecordingsModel.deleteMessage(waiting) == RecordingsModel.deleteUnsyncedNote)
        let uploaded = RecordingView(
            recording: waiting.recording, file: RecordingFile(id: "r", localState: .uploaded), tuneID: nil,
            tuneTitle: nil)
        #expect(RecordingsModel.deleteMessage(uploaded) == RecordingsModel.deleteSyncedNote)
        #expect(RecordingsModel.deleteMessage(view("r", tune: nil, minutes: 0)) == RecordingsModel.deleteSyncedNote)
    }
}

@Suite struct RecordingsFilterTests {
    @Test func labelsTheFilterAndItsChoices() {
        #expect(RecordingsListText.source == "Source")
        #expect(RecordingsListText.all == "All")
        #expect(RecordingsListText.mine == "Mine")
        #expect(RecordingsListText.filtersDisabledReason == "All recordings are yours")
        #expect(RecordingsFilterSheet.label(for: RecordingsModel.allChoice) == "All")
        #expect(RecordingsFilterSheet.label(for: "own") == "Mine")
        #expect(RecordingsFilterSheet.label(for: "slippery_hill") == "Slippery-Hill")
        #expect(FiltersButton.name(setCount: 1) == "Filters, 1 set")
        #expect(RemoveFilterCapsule.name("Slippery-Hill") == "Remove filter Slippery-Hill")
        #expect(RecordingRowActions.openOn("Slippery-Hill") == "Open on Slippery-Hill")
    }

    @Test func putsOwnRecordingsFirstOnATunesRows() {
        func rec(_ id: String, _ origin: String) -> TuneRecording {
            TuneRecording(
                recording: Recording(id: id, tuneID: "t", source: "microphone", origin: origin, addedAt: noon),
                file: nil)
        }
        let rows = TuneDetail.ownFirst([
            rec("a", "slippery_hill"), rec("b", "own"), rec("c", "slippery_hill"), rec("d", "own"),
        ])
        #expect(rows.map(\.id) == ["b", "d", "a", "c"])
    }
}

@MainActor
@Suite struct RecordingsModelTests {
    @Test func readsLiveRecordingsGroupedWithUnfinishedCapturesAndStorage() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (kept, _) = try await commands.createTune(
            TuneInput(title: "Kitchen Girl"), userTune: UserTuneInput(status: "known"))
        let (gone, _) = try await commands.createTune(
            TuneInput(title: "Gone Tune"), userTune: UserTuneInput(status: "known"))
        try await putRecording(store, "filed", tuneID: kept, minutes: 1)
        try await putRecording(store, "orphan", tuneID: gone, minutes: 2)
        try await putRecording(store, "loose", minutes: 3)
        try await putRecording(store, "deleted", minutes: 4)
        try await store.write { writer in
            // As a pull from another device leaves it: the tune gone, its recording still here.
            try writer.tombstone(Tune.self, id: gone, at: noon)
            try writer.tombstone(Recording.self, id: "deleted", at: noon)
            try RecordingFile(id: "stuck", localState: .capturing, fileName: "stuck.aac", recordedAt: noon)
                .insert(writer.db)
            try writer.setMeta(.storage, to: StorageFigures(usedBytes: 5, quotaBytes: 10, maxFileBytes: 4))
        }

        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        let arrangement = try #require(model.arrangement(.default))
        // A recording whose tune was deleted elsewhere reads as unfiled.
        #expect(arrangement.unfiled.map(\.id) == ["loose", "orphan"])
        #expect(arrangement.filed == .flat(filedViews(arrangement)))
        #expect(filedViews(arrangement).map(\.id) == ["filed"])
        #expect(filedViews(arrangement).first?.tuneTitle == "Kitchen Girl")
        #expect(!model.hasNoRecordings)
        #expect(model.unfinished.map(\.id) == ["stuck"])
        #expect(model.storage?.usedBytes == 5)
    }

    @Test func offersTheSitesHeldAndFiltersTheListsByTheChoice() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Kitchen Girl"), userTune: UserTuneInput(status: "known"))
        try await putRecording(store, "mine", minutes: 1)
        try await putRecording(store, "theirs", tuneID: tuneID, minutes: 2, origin: "slippery_hill")
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default).map(filedViews)?.map(\.id) == ["theirs"] }
        #expect(model.arrangement(.default)?.unfiled.map(\.id) == ["mine"])
        #expect(model.sourceOptions == ["all", "own", "slippery_hill"])
        #expect(model.choice == "all")
        #expect(model.filterCount == 0)
        #expect(model.filtersGate == .enabled)

        await model.setChoice("slippery_hill")
        try await eventually { model.arrangement(.default)?.unfiled.isEmpty == true }
        #expect(model.arrangement(.default).map(filedViews)?.map(\.id) == ["theirs"])
        #expect(try await store.meta(.recordingsOrigin, as: String.self) == "slippery_hill")
        #expect(model.filterCount == 1)
        await model.setChoice("own")
        try await eventually { model.arrangement(.default).map(filedViews)?.isEmpty == true }
        #expect(model.arrangement(.default)?.unfiled.map(\.id) == ["mine"])
    }

    @Test func resetReturnsTheSourceToAll() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "theirs", origin: "slippery_hill")
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        await model.setChoice("slippery_hill")
        await model.resetSource()
        #expect(model.choice == "all")
        #expect(model.filterCount == 0)
        #expect(try await store.meta(.recordingsOrigin, as: String.self) == "all")
    }

    @Test func keepsAStaleSiteAsAnOptionWhileItIsChosen() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "mine")
        try await store.setMeta(.recordingsOrigin, to: "slippery_hill")
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        #expect(model.choice == "slippery_hill")
        #expect(model.sourceOptions == ["all", "own", "slippery_hill"])
        #expect(model.filterCount == 1)
        // A set source keeps its way back to All, even with only own recordings.
        #expect(model.filtersGate == .enabled)
        let arrangement = model.arrangement(.default)
        #expect(arrangement?.isEmpty == true)
        #expect(model.showsNothingMatches(arrangement))

        await model.setChoice("all")
        #expect(model.sourceOptions == ["all", "own"])
    }

    @Test func aStaleOwnChoiceAddsNoExtraOption() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "theirs", origin: "slippery_hill")
        try await store.setMeta(.recordingsOrigin, to: "own")
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        #expect(model.sourceOptions == ["all", "own", "slippery_hill"])
        #expect(model.showsNothingMatches(model.arrangement(.default)))
    }

    @Test func disablesFiltersWithOnlyOwnRecordingsAndSaysWhy() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "mine")
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        #expect(model.sourceOptions == ["all", "own"])
        #expect(model.filtersGate == .disabled(reason: RecordingsListText.filtersDisabledReason))
        await model.setChoice("own")
        #expect(model.filtersGate == .enabled)
        #expect(model.filterCount == 1)
    }

    @Test func disablesFiltersSilentlyUntilLoadedAndWithNoRecordings() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = RecordingsModel(store: store)
        #expect(model.filtersGate == .disabled(reason: nil))
        try await eventually { model.arrangement(.default) != nil }
        #expect(model.filtersGate == .disabled(reason: nil))
        #expect(!model.showsNothingMatches(model.arrangement(.default)))
    }

    @Test func saysNothingMatchesWhenASearchNarrowsToNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "mine", label: "Waltz")
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        #expect(!model.showsNothingMatches(model.arrangement(.default)))
        model.query = "reel"
        #expect(model.showsNothingMatches(model.arrangement(.default)))
    }

    @Test func saysNothingMatchesWhenOnlyCapturesAreLeftOut() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            try RecordingFile(id: "stuck", localState: .capturing, fileName: "stuck.aac", recordedAt: noon)
                .insert(writer.db)
        }
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        #expect(model.hasNoRecordings)
        #expect(!model.showsNothingMatches(model.arrangement(.default)))
        model.query = "waltz"
        #expect(model.showsNothingMatches(model.arrangement(.default)))
        model.query = ""
        await model.setChoice("slippery_hill")
        #expect(model.showsNothingMatches(model.arrangement(.default)))
    }

    @Test func hidesNotSavedWhileAQueryOrASiteIsSet() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "theirs", origin: "slippery_hill")
        try await store.write { writer in
            try RecordingFile(id: "stuck", localState: .capturing, fileName: "stuck.aac", recordedAt: noon)
                .insert(writer.db)
        }
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        #expect(model.showsUnfinished)
        await model.setChoice("own")
        #expect(model.showsUnfinished)
        // Captures are the musician's own, and match no search.
        #expect(!model.showsNothingMatches(model.arrangement(.default)))
        model.query = "  "
        #expect(model.showsUnfinished)
        model.query = "waltz"
        #expect(!model.showsUnfinished)
        model.query = ""
        await model.setChoice("slippery_hill")
        #expect(!model.showsUnfinished)
    }

    @Test func opensOnlyWebPagesOfAnImport() {
        func page(_ url: String?) -> URL? {
            RecordingRowActions.originPage(
                Recording(tuneID: nil, source: "import", origin: "slippery_hill", originURL: url, addedAt: noon))
        }
        #expect(page("http://example.com/a")?.absoluteString == "http://example.com/a")
        #expect(page("https://example.com/a") != nil)
        #expect(page("HTTPS://example.com/a") != nil)
        #expect(page("javascript:alert(1)") == nil)
        #expect(page("file:///etc/passwd") == nil)
        #expect(page("not a url") == nil)
        #expect(page(nil) == nil)
    }

    @Test func readsAnUnreadableChoiceAsAll() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "mine")
        try await store.setMeta(.recordingsOrigin, to: 5)
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        #expect(model.choice == "all")
    }

    @Test func ordersOriginsByVocabularyWithUnknownLast() {
        #expect(
            RecordingsModel.sortedOrigins(["zeta", "slippery_hill", "alpha"]) == ["slippery_hill", "alpha", "zeta"])
    }

    @Test func hidesStorageUntilTheServerSaysWhatTheQuotaIs() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 0, quotaBytes: 0, maxFileBytes: 0))
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        #expect(model.storage == nil)
        #expect(model.hasNoRecordings)
    }

    @Test func discardsAnUnfinishedCaptureAndItsAudio() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let audio = store.audioFolder.appending(path: "stuck.aac")
        try Data(repeating: 1, count: 16).write(to: audio)
        try await store.write { writer in
            try RecordingFile(id: "stuck", localState: .capturing, fileName: "stuck.aac", recordedAt: noon)
                .insert(writer.db)
        }
        let model = RecordingsModel(store: store)
        try await eventually { !model.unfinished.isEmpty }

        await model.discard(try #require(model.unfinished.first))
        #expect(model.failure == nil)
        try await eventually { model.unfinished.isEmpty }
        #expect(!FileManager.default.fileExists(atPath: audio.path(percentEncoded: false)))
    }

    @Test func deletesARecordingAndTakesOneOutOfItsTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Kitchen Girl"), userTune: UserTuneInput(status: "known"))
        try await putRecording(store, "filed", tuneID: tuneID)
        try await putRecording(store, "loose", minutes: 1)
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default).map(filedViews)?.count == 1 }

        await model.removeFromTune("filed")
        try await eventually { model.arrangement(.default)?.unfiled.map(\.id) == ["loose", "filed"] }
        #expect(model.arrangement(.default).map(filedViews) == [])
        await model.delete("loose")
        try await eventually { model.arrangement(.default)?.unfiled.map(\.id) == ["filed"] }
        #expect(model.failure == nil)
    }

    @Test func searchingATunesTitleLeavesOnlyThatTunesRecordings() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (joy, _) = try await commands.createTune(
            TuneInput(title: "Soldier's Joy"), userTune: UserTuneInput(status: "known"))
        let (girl, _) = try await commands.createTune(
            TuneInput(title: "Kitchen Girl"), userTune: UserTuneInput(status: "known"))
        try await putRecording(store, "joy_old", tuneID: joy, minutes: 1)
        try await putRecording(store, "girl", tuneID: girl, minutes: 2)
        try await putRecording(store, "joy_new", tuneID: joy, minutes: 3)
        try await putRecording(store, "loose", minutes: 4)
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }

        model.query = "soldier's joy"
        let arrangement = try #require(model.arrangement(.default))
        #expect(arrangement.unfiled.isEmpty)
        #expect(filedViews(arrangement).map(\.id) == ["joy_new", "joy_old"])
    }

    @Test func keepsTheQueryAcrossStoreWrites() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "jig", label: "Jig take", minutes: 1)
        try await putRecording(store, "reel", label: "Reel take", minutes: 2)
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default)?.unfiled.count == 2 }

        model.query = "jig"
        try await putRecording(store, "jig2", label: "Second jig", minutes: 3)
        try await eventually { model.arrangement(.default)?.unfiled.map(\.id) == ["jig2", "jig"] }
        #expect(model.query == "jig")
    }

    @Test func reportsAWriteThatFails() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = RecordingsModel(store: store)
        await model.removeFromTune("missing")
        #expect(model.failure == CommandError.recordingNotFoundMessage)
    }

    @Test func clearsAFailureOnRequest() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = RecordingsModel(store: store)
        await model.removeFromTune("missing")
        #expect(model.failure != nil)
        model.clearFailure()
        #expect(model.failure == nil)
    }
}

@MainActor
@Suite struct RecordingsScreenPartsTests {
    @Test func aTuneLineIsAControlOfItsOwnBesideTheRow() {
        let row = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), verb: "Play", action: {},
            tuneLine: MediaRow.TuneLine(title: "Soldier's Joy", action: {}))
        #expect(row.controlNames == ["Play Take 1, 1:02", "Open Soldier's Joy"])

        let unfiled = MediaRow(glyph: .play, title: "Take 1", secondLine: .text("1:02"), verb: "Play", action: {})
        #expect(unfiled.controlNames == ["Play Take 1, 1:02"])
    }

    @Test func drawsItsInnerControlsInReadingOrderWithRetryAtTheTrailingEdge() {
        let row = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), verb: "Play", action: {},
            tuneLine: MediaRow.TuneLine(title: "Soldier's Joy", action: {}),
            retry: MediaRow.Retry(name: "Retry Take 1", action: {}))
        #expect(row.innerControls.map(\.name) == ["Open Soldier's Joy", "Retry Take 1"])
        #expect(row.innerControls.map(\.isTrailing) == [false, true])
        #expect(row.controlNames == ["Play Take 1, 1:02", "Open Soldier's Joy", "Retry Take 1"])
    }

    @Test func anImportsSourceLineComesBeforeTheTuneLine() throws {
        let page = try #require(URL(string: "https://www.slippery-hill.com/content/bear-creek-sally-goodin"))
        let row = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), verb: "Play", action: {},
            sourceLine: MediaRow.SourceLine(title: "Slippery-Hill", url: page),
            tuneLine: MediaRow.TuneLine(title: "Soldier's Joy", action: {}),
            retry: MediaRow.Retry(name: "Retry Take 1", action: {}))
        #expect(
            row.controlNames == [
                "Play Take 1, 1:02", "Open on Slippery-Hill", "Open Soldier's Joy", "Retry Take 1",
            ])
        #expect(row.innerControls.map(\.isTrailing) == [false, false, true])
        #expect(row.stacksLineControls, "two padded line targets would overlap")
        let sourceOnly = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), verb: "Play", action: {},
            sourceLine: MediaRow.SourceLine(title: "Slippery-Hill", url: page),
            retry: MediaRow.Retry(name: "Retry Take 1", action: {}))
        #expect(!sourceOnly.stacksLineControls, "one line reaches into the row's space without growing it")
        let tuneOnly = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), verb: "Play", action: {},
            tuneLine: MediaRow.TuneLine(title: "Soldier's Joy", action: {}))
        #expect(!tuneOnly.stacksLineControls)
        #expect(
            MediaRow.SourceLine(title: "Slippery-Hill", url: page).name == RecordingRowActions.openOn("Slippery-Hill"))
    }

    @Test func filedRowsOfferGoToTuneAfterRemoveFromTune() {
        let menu = RecordingRowAction.menu(
            filed: true, canAddToTune: true, canGoToTune: true, canPin: false, originSite: nil)
        #expect(
            menu.map(\.title) == [
                RecordingRowActions.edit, RecordingRowActions.removeFromTune, RecordingsListText.goToTune,
                RecordingRowActions.delete,
            ])
        let swipe = RecordingRowAction.swipe(filed: true, canAddToTune: true, canGoToTune: true, canPin: false)
        #expect(
            swipe.map(\.title) == [
                RecordingRowActions.delete, RecordingRowActions.removeFromTune, RecordingsListText.goToTune,
                RecordingRowActions.edit,
            ])
    }

    @Test func goToTuneStaysOutWithoutItsActionOrATune() {
        let unasked = RecordingRowAction.menu(
            filed: true, canAddToTune: false, canGoToTune: false, canPin: true, originSite: nil)
        #expect(!unasked.contains(.goToTune))
        #expect(unasked.contains(.pin))
        let unfiled = RecordingRowAction.menu(
            filed: false, canAddToTune: true, canGoToTune: true, canPin: false, originSite: nil)
        #expect(
            unfiled.map(\.title) == [
                RecordingRowActions.edit, RecordingRowActions.addToTune, RecordingRowActions.delete,
            ])
    }

    @Test func offersOpenOnInTheMenuBeforeDeleteButNeverInTheSwipe() {
        let menu = RecordingRowAction.menu(
            filed: true, canAddToTune: true, canGoToTune: true, canPin: false, originSite: "Slippery-Hill")
        #expect(
            menu.map(\.title) == [
                RecordingRowActions.edit, RecordingRowActions.removeFromTune, RecordingsListText.goToTune,
                RecordingRowActions.openOn("Slippery-Hill"), RecordingRowActions.delete,
            ])
        let swipe = RecordingRowAction.swipe(filed: true, canAddToTune: true, canGoToTune: true, canPin: false)
        #expect(!swipe.contains(.openOrigin(site: "Slippery-Hill")))
    }
}

@MainActor
@Suite struct RecordingSheetModelTests {
    @Test func savesATrimmedNameAndClearsItWhenLeftBlank() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let stored = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let edit = EditRecordingModel(store: store, recording: stored)
        #expect(!edit.isEdited)
        edit.setName("  Take 2  ")
        #expect(edit.isEdited)
        #expect(await edit.save())
        #expect(!(await edit.save()))
        let label = try await store.read { db in try Recording.fetchOne(db, key: "r1")?.label }
        #expect(label == "Take 2")

        let named = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let clear = EditRecordingModel(store: store, recording: named)
        #expect(clear.name == "Take 2")
        clear.setName("   ")
        #expect(await clear.save())
        let cleared = try await store.read { db in try Recording.fetchOne(db, key: "r1") }
        #expect(cleared?.label == nil)
    }

    @Test func reportsAnEditThatFails() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let missing = Recording(id: "missing", tuneID: nil, source: "microphone", addedAt: noon)
        let edit = EditRecordingModel(store: store, recording: missing)
        #expect(!(await edit.save()))
        #expect(edit.failure == CommandError.recordingNotFoundMessage)
        edit.setName("x")
        #expect(edit.failure == nil)
    }

    @Test func keepsATakesExactTimeWhenOnlyTheNameChanges() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let taken = try #require(Timestamp(iso: "2026-10-04T01:30:12.345Z"))
        try await putDated(store, "r1", at: taken, precision: RecordingPrecision.time.rawValue)
        let stored = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let edit = EditRecordingModel(store: store, recording: stored, timeZone: losAngeles)
        #expect(edit.date.keepsTime)
        edit.setName("Jam at Tom's")
        #expect(await edit.save())
        let saved = try await store.read { db in try Recording.fetchOne(db, key: "r1") }
        #expect(saved?.label == "Jam at Tom's")
        #expect(saved?.recordedAt == taken)
        #expect(saved?.recordedPrecision == RecordingPrecision.time.rawValue)
    }

    @Test func writesNoDateWhenTheDatePartsAreLeftAlone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        // A precision newer than this build opens as no date; saving the name must not clear it.
        let stored = try #require(Timestamp(iso: "1998-06-21T00:00:00.000Z"))
        try await putDated(store, "r1", at: stored, precision: "season")
        let recording = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let edit = EditRecordingModel(store: store, recording: recording, timeZone: losAngeles)
        #expect(edit.date.year.isEmpty)
        edit.setName("Summer jam")
        #expect(await edit.save())
        let saved = try await store.read { db in try Recording.fetchOne(db, key: "r1") }
        #expect(saved?.label == "Summer jam")
        #expect(saved?.recordedAt == stored)
        #expect(saved?.recordedPrecision == "season")
    }

    @Test func savesAYearAsUTCMidnightOnItsFirstDayWestOfUTC() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let recording = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let edit = EditRecordingModel(store: store, recording: recording, timeZone: losAngeles)
        edit.setYear("1937")
        #expect(edit.isEdited)
        #expect(await edit.save())
        let saved = try await store.read { db in try Recording.fetchOne(db, key: "r1") }
        #expect(saved?.recordedAt == Timestamp(iso: "1937-01-01T00:00:00.000Z"))
        #expect(saved?.recordedPrecision == RecordingPrecision.year.rawValue)
    }

    @Test func clearsTheDateToUnknown() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let year = try #require(Timestamp(iso: "1937-01-01T00:00:00.000Z"))
        try await putDated(store, "r1", at: year, precision: RecordingPrecision.year.rawValue)
        let recording = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let edit = EditRecordingModel(store: store, recording: recording, timeZone: losAngeles)
        #expect(edit.date.year == "1937")
        edit.clearDate()
        #expect(await edit.save())
        let saved = try await store.read { db in try Recording.fetchOne(db, key: "r1") }
        #expect(saved?.recordedAt == nil)
        #expect(saved?.recordedPrecision == nil)
    }

    @Test func refusesAYearAfterThisOneAndWritesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let recording = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let now = try #require(Timestamp(iso: "2026-10-04T12:00:00.000Z"))
        let edit = EditRecordingModel(store: store, recording: recording, timeZone: losAngeles, now: { now })
        edit.setName("Take 2")
        edit.setYear("2027")
        #expect(!(await edit.save()))
        #expect(edit.dateFailure == CommandError.recordedDateFutureMessage)
        let saved = try await store.read { db in try Recording.fetchOne(db, key: "r1") }
        #expect(saved?.label == nil)
        #expect(saved?.recordedAt == nil)
        edit.setYear("1998")
        #expect(edit.dateFailure == nil)
    }

    @Test func filesARecordingUnderThePickedTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Kitchen Girl"), userTune: UserTuneInput(status: "known"))
        try await putRecording(store, "r1")
        let model = AddToTuneModel(store: store, recordingID: "r1")
        try await eventually { model.results != nil }
        #expect(model.results?.rows.isEmpty == true)

        model.query = "kitchen"
        let entry = try #require(model.results?.rows.first)
        #expect(AddToTuneModel.rowName(entry) == "Add to Kitchen Girl")
        #expect(await model.pick(entry))
        let filed = try await store.read { db in try Recording.fetchOne(db, key: "r1")?.tuneID }
        #expect(filed == tuneID)
    }

    @Test func offersToStartATuneWhenNothingMatches() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let model = AddToTuneModel(store: store, recordingID: "r1")
        try await eventually { model.results != nil }
        model.query = "Sally Goodin"
        #expect(model.results?.outcome.offerLabel == "Add \"Sally Goodin\"")
        #expect(await model.submit() == .create(title: "Sally Goodin"))
    }
}

@MainActor
@Suite struct RecordingImportTests {
    private func write(_ name: String, bytes: Int, in root: TemporaryRoot) throws -> URL {
        let folder = root.url.appending(path: "picked", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name)
        try Data(repeating: 7, count: bytes).write(to: url)
        return url
    }

    /// A real, decodable tone, unlike ``write(_:bytes:in:)``'s garbage bytes, for the tests that
    /// need an import to actually decode.
    private func writeTone(_ name: String, seconds: Double, in root: TemporaryRoot) throws -> URL {
        let folder = root.url.appending(path: "picked", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name)
        let writer = try CaptureWriter(url: url, bitrate: 64_000, channels: 1)
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
        let frames = AVAudioFrameCount(seconds * 48_000)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let samples = buffer.floatChannelData![0]
        for frame in 0..<Int(frames) { samples[frame] = 0.5 * Float(sin(2 * .pi * 440 * Double(frame) / 48_000)) }
        try writer.write(buffer)
        writer.close()
        return url
    }

    @Test func copiesAnAudioFileInAsAnUnfiledRecordingNamedForIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let picked = try write("Jam at Tom's.m4a", bytes: 1_000, in: root)
        let id = try await RecordingImport.add(picked, to: store, tuneID: nil, at: noon)

        let (recording, file) = try await store.read { db in
            (try Recording.fetchOne(db, key: id), try RecordingFile.fetchOne(db, key: id))
        }
        #expect(recording?.label == "Jam at Tom's")
        #expect(recording?.source == "upload")
        #expect(recording?.tuneID == nil)
        #expect(file?.localState == .captured)
        #expect(file?.bytes == 1_000)
        #expect(file?.contentType?.hasPrefix("audio/") == true)
        let name = try #require(file?.fileName)
        #expect(
            FileManager.default.fileExists(atPath: store.audioFolder.appending(path: name).path(percentEncoded: false)))
        #expect(FileManager.default.fileExists(atPath: picked.path(percentEncoded: false)))
    }

    @Test func writesTheImportedFilesWaveformBesideItsAudio() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let picked = try writeTone("Jam.m4a", seconds: 1, in: root)

        let id = try await RecordingImport.add(picked, to: store, tuneID: nil, at: noon)

        let file = try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: id) })
        let name = try #require(file.peaksFileName)
        let peaks = try Peaks(file: Data(contentsOf: store.audioFolder.appending(path: name)))
        #expect(peaks.pointsPerSecond == Peaks.pointsPerSecond)
        #expect(!peaks.values.isEmpty)
    }

    @Test func aFailureAfterWritingBothFilesRemovesBoth() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try Data([1, 2, 3]).write(to: store.audioFolder.appending(path: "r1-import.m4a"))
        try Data([1, 0, 50]).write(to: store.audioFolder.appending(path: "r1-import.peaks"))

        RecordingImport.cleanUpAfterFailure(fileName: "r1-import.m4a", peaksFileName: "r1-import.peaks", in: store)

        let left = try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path(percentEncoded: false))
        #expect(left.isEmpty, "a failed import leaves neither the audio nor its peaks file behind")
    }

    @Test func aFailureWithNoPeaksFileRemovesOnlyTheAudio() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try Data([1, 2, 3]).write(to: store.audioFolder.appending(path: "r1-import.m4a"))

        RecordingImport.cleanUpAfterFailure(fileName: "r1-import.m4a", peaksFileName: nil, in: store)

        let left = try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path(percentEncoded: false))
        #expect(left.isEmpty)
    }

    @Test func anImportedAACFileSurvivesRecoveryAndTheSweep() async throws {
        let root = TemporaryRoot()
        let first = try root.open()
        let id = try await RecordingImport.add(try write("Jam.aac", bytes: 1_000, in: root), to: first, tuneID: nil)
        try first.close()

        let store = try root.open()
        await Recorder.recoverLeftoverCaptures(in: store)

        let file = try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: id) })
        #expect(file.localState == .captured)
        let name = try #require(file.fileName)
        #expect(name != CaptureFiles.captureName(id), "an import never takes a capture's name")
        #expect(
            FileManager.default.fileExists(atPath: store.audioFolder.appending(path: name).path(percentEncoded: false)))
    }

    @Test func importsEveryFileOfABatchAndNamesTheOneItRefused() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = RecordingsModel(store: store)
        let urls = [
            try write("Jam.m4a", bytes: 1_000, in: root),
            try write("notes.txt", bytes: 10, in: root),
            try write("Reel.wav", bytes: 1_000, in: root),
        ]

        await model.importAudio(from: urls)

        #expect(model.failure == RecordingImport.refused("notes.txt", RecordingImport.notAudio))
        let labels = try await store.read { db in try Recording.fetchAll(db).map(\.label) }
        #expect(Set(labels) == ["Jam", "Reel"])
    }

    @Test func aSingleRefusedFileKeepsTheBareMessage() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = RecordingsModel(store: store)

        await model.importAudio(from: [try write("notes.txt", bytes: 10, in: root)])

        #expect(model.failure == RecordingImport.notAudio)
    }

    @Test func refusesWhatTheServerWouldNeverTake() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 0, quotaBytes: 10_000, maxFileBytes: 2_000_000))
        let cases: [(URL, String)] = [
            (try write("notes.txt", bytes: 10, in: root), RecordingImport.notAudio),
            (try write("empty.mp3", bytes: 0, in: root), RecordingImport.emptyFile),
            (try write("huge.wav", bytes: 2_000_001, in: root), "Files are limited to 2 MB."),
        ]
        for (url, message) in cases {
            await #expect(throws: RecordingImport.Refusal(message: message)) {
                try await RecordingImport.add(url, to: store, tuneID: nil)
            }
        }
        let count = try await store.read { db in try Recording.fetchCount(db) }
        #expect(count == 0)
        let copied = try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path(percentEncoded: false))
        #expect(copied.isEmpty)
    }
}

@MainActor
@Suite struct RecordingTransferTests {
    @Test func remembersADownloadThatFetchedNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let engine = SyncEngine(store: store, api: RefusingSyncAPI(), isOffline: { false }, sleep: { _ in })
        let transfers = RecordingTransferActions(engine: engine, store: store)

        await transfers.download("r1")
        #expect(transfers.failedDownloads == ["r1"])
        #expect(!transfers.isDownloading("r1"))

        await transfers.download("r1")
        #expect(transfers.failedDownloads == ["r1"])
    }

    @Test func dimsAPlayWhileATakeIsRecordedAndSaysWhy() throws {
        let recording = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready")
        let held = RecordingFile(id: "r1", localState: .downloaded, fileName: "r1.m4a")
        let blocked = RecordingRowContent(recording: recording, file: held, tuneTitle: nil, playBlocked: true)
        #expect(blocked.isDimmed)
        #expect(blocked.notice == MediaText.stopRecordingToPlay)
        // The tap stays, and the player refuses it.
        #expect(blocked.tap == .play)
        let free = RecordingRowContent(recording: recording, file: held, tuneTitle: nil)
        #expect(!free.isDimmed && free.notice == nil)
        // Only a play is refused; a download row carries on as it was.
        let download = RecordingRowContent(recording: recording, file: nil, tuneTitle: nil, playBlocked: true)
        #expect(download.notice == nil && !download.isDimmed)

        var link = RecordingLink(id: "l1", tuneID: "t1", url: "https://example.com/x", provider: "youtube")
        link.providerRef = "dQw4w9WgXcQ"
        let linkRow = LinkRowContent(link: link, embeddable: true, playBlocked: true)
        #expect(linkRow.isDimmed && linkRow.notice == MediaText.stopRecordingToPlay && linkRow.tap == .play)
        let opened = LinkRowContent(link: link, embeddable: false, playBlocked: true)
        #expect(!opened.isDimmed && opened.notice == nil)
    }

    @Test func asksToDeleteAnUnfinishedCaptureWhenItsRowIsTapped() {
        let capture = RecordingFile(id: "c1", localState: .capturing, recordedAt: noon)
        let row = UnfinishedCaptureRowContent(
            capture: capture, locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "UTC")!)
        #expect(row.verb == RecordingRowActions.delete)
        #expect(row.title == "Recording, Sep 25, 2026 at 12:00\u{202F}PM")
    }

    @Test func saysCouldNotDownloadOnlyWhileTheRowStillOffersADownload() {
        let recording = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready")
        let failed = RecordingRowContent(recording: recording, file: nil, tuneTitle: nil, downloadFailed: true)
        #expect(failed.error == RecordingText.downloadFailed)
        #expect(failed.tap == .download)

        let fetchedSince = RecordingRowContent(
            recording: recording, file: RecordingFile(id: "r1", localState: .downloaded, fileName: "r1.m4a"),
            tuneTitle: nil, downloadFailed: true)
        #expect(fetchedSince.error == nil)
        #expect(fetchedSince.tap == .play)
    }
}

@MainActor
@Suite struct RecorderHostCaptureTests {
    @Test func holdsPlaybackBackWhileARecordSheetHasTheRecorder() throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let host = RecorderHost()
        #expect(!host.isCapturing)
        _ = try #require(host.claim(for: store))
        #expect(host.isCapturing)
        host.release()
        #expect(!host.isCapturing)
    }
}

/// The Edit sheet's date, read and written west of UTC, where a local read of a partial date
/// lands in the period before it.
@Suite struct RecordingDateDraftTests {
    private let now = Timestamp(iso: "2026-10-04T12:00:00.000Z")!

    private func at(_ iso: String) -> Timestamp { Timestamp(iso: iso)! }

    private func draft(_ iso: String? = nil, _ precision: RecordingPrecision? = nil) -> RecordingDateDraft {
        RecordingDateDraft(recordedAt: iso.map(at), precision: precision, timeZone: losAngeles)
    }

    private func parts(_ draft: RecordingDateDraft) -> [String] {
        [draft.year, draft.month.map(String.init) ?? "", draft.day.map(String.init) ?? ""]
    }

    @Test func opensAPartialDateInUTCWestOfIt() {
        // Proves the zone bites: local time reads the stored instant as the year before.
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = losAngeles
        #expect(calendar.component(.year, from: at("1937-01-01T00:00:00Z").date) == 1936)
        #expect(parts(draft("1937-01-01T00:00:00.000Z", .year)) == ["1937", "", ""])
        #expect(parts(draft("1998-05-01T00:00:00.000Z", .month)) == ["1998", "5", ""])
        #expect(parts(draft("1998-10-03T00:00:00.000Z", .day)) == ["1998", "10", "3"])
        #expect(!draft("1937-01-01T00:00:00.000Z", .year).keepsTime)
    }

    @Test func opensATakeAsTheLocalDayItShowsAndKeepsItsTime() {
        // 01:30 UTC on Oct 4 is still Oct 3 in Los Angeles.
        let take = draft("2026-10-04T01:30:00.000Z", .time)
        #expect(parts(take) == ["2026", "10", "3"])
        #expect(take.keepsTime)
        #expect(take.keptTake == at("2026-10-04T01:30:00.000Z"))
    }

    @Test func opensAnUnknownDateAsNoParts() {
        let unknown = draft()
        #expect(parts(unknown) == ["", "", ""])
        #expect(unknown.isEmpty)
        #expect(!unknown.isChanged)
    }

    @Test func storesAYearAsUTCMidnightOnJanuaryFirst() throws {
        var year = draft()
        year.setYear("1937")
        let resolved = try year.resolved(now: now)
        #expect(resolved.at == at("1937-01-01T00:00:00.000Z"))
        #expect(resolved.precision == .year)
    }

    @Test func storesAMonthAndADayAtUTCMidnightOnTheirFirstDay() throws {
        var month = draft()
        month.setYear("1998")
        month.setMonth(5)
        let byMonth = try month.resolved(now: now)
        #expect(byMonth.at == at("1998-05-01T00:00:00.000Z"))
        #expect(byMonth.precision == .month)
        month.setMonth(10)
        month.setDay(3)
        let byDay = try month.resolved(now: now)
        #expect(byDay.at == at("1998-10-03T00:00:00.000Z"))
        #expect(byDay.precision == .day)
    }

    @Test func readsABlankYearAsNoDateWhateverMonthIsLeftBehindIt() throws {
        var blank = draft("1998-10-03T00:00:00.000Z", .day)
        blank.setYear("")
        #expect(blank.month == 10)
        let resolved = try blank.resolved(now: now)
        #expect(resolved.at == nil)
        #expect(resolved.precision == nil)
    }

    @Test func refusesAYearThatIsNotFourDigits() {
        var short = draft()
        short.setYear("98")
        #expect(throws: RecordingDateDraft.Problem.yearFormat) { try short.resolved(now: now) }
        short.setYear("0999")
        #expect(throws: RecordingDateDraft.Problem.yearFormat) { try short.resolved(now: now) }
        #expect(RecordingDateDraft.Problem.yearFormat.message == "Enter the year as four digits.")
    }

    @Test func refusesAYearAfterThisOneAndAMonthNotYetBegun() {
        var future = draft()
        future.setYear("2027")
        #expect(throws: RecordingDateDraft.Problem.future) { try future.resolved(now: now) }
        future.setYear("2026")
        future.setMonth(12)
        #expect(throws: RecordingDateDraft.Problem.future) { try future.resolved(now: now) }
        #expect(RecordingDateDraft.Problem.future.message == CommandError.recordedDateFutureMessage)
    }

    @Test func acceptsADayWithinTheClockLeeway() throws {
        var tomorrow = draft()
        tomorrow.setYear("2026")
        tomorrow.setMonth(10)
        tomorrow.setDay(5)
        let resolved = try tomorrow.resolved(now: now)
        #expect(resolved.at == at("2026-10-05T00:00:00.000Z"))
        #expect(resolved.precision == .day)
    }

    @Test func takesOnlyDigitsUpToFour() {
        var year = draft()
        year.setYear("19a37 5")
        #expect(year.year == "1937")
    }

    @Test func enablesMonthOnceAYearIsSetAndDayOnceAMonthIs() {
        var date = draft()
        #expect(!date.isMonthEnabled)
        #expect(!date.isDayEnabled)
        date.setYear("199")
        #expect(!date.isMonthEnabled)
        date.setYear("1998")
        #expect(date.isMonthEnabled)
        #expect(!date.isDayEnabled)
        date.setMonth(5)
        #expect(date.isDayEnabled)
    }

    @Test func endsFebruaryAtThe29thInALeapYearAndThe28thOtherwise() {
        var february = draft()
        february.setYear("2024")
        february.setMonth(2)
        #expect(february.dayCount == 29)
        february.setYear("2023")
        #expect(february.dayCount == 28)
        february.setYear("1900")
        #expect(february.dayCount == 28)
    }

    @Test func offers31DaysWhileTheYearIsUnfinishedAndNoneWithoutAMonth() {
        var date = draft()
        date.setYear("1998")
        #expect(date.dayCount == 0)
        date.setMonth(4)
        date.setYear("19")
        #expect(date.dayCount == 31)
    }

    @Test func keepsAChosenDayWhileTheYearIsRetyped() {
        var date = draft("2024-02-29T00:00:00.000Z", .day)
        date.setYear("202")
        #expect(date.day == 29)
        date.setYear("2024")
        #expect(date.day == 29)
        date.setYear("2023")
        #expect(date.day == nil, "Feb 29 reads as Any in a common year rather than rolling over")
    }

    @Test func dropsADayTheNewMonthLacksAndAnyDayWithoutAMonth() {
        var date = draft("1998-03-31T00:00:00.000Z", .day)
        date.setMonth(4)
        #expect(date.day == nil)
        date.setDay(30)
        date.setMonth(nil)
        #expect(date.day == nil)
    }

    @Test func dropsATakesTimeOnceItsDatePartsChange() throws {
        var take = draft("2026-10-04T01:30:00.000Z", .time)
        let kept = try take.resolved(now: now)
        #expect(kept.at == at("2026-10-04T01:30:00.000Z"))
        #expect(kept.precision == .time)
        take.setDay(2)
        #expect(take.isChanged)
        #expect(!take.keepsTime)
        #expect(take.keptTake == nil)
        let moved = try take.resolved(now: now)
        #expect(moved.at == at("2026-10-02T00:00:00.000Z"))
        #expect(moved.precision == .day)
        take.setDay(3)
        #expect(!take.isChanged)
        #expect(take.keepsTime)
    }

    @Test func clearsEveryPart() {
        var date = draft("1998-10-03T00:00:00.000Z", .day)
        #expect(!date.isEmpty)
        date.clear()
        #expect(parts(date) == ["", "", ""])
        #expect(date.isEmpty)
        #expect(date.isChanged)
    }

    @Test func notesATakesTimeInTheLocalZone() {
        let note = EditRecordingText.recordedAtNote(
            at("2026-10-04T01:30:00.000Z"), locale: Locale(identifier: "en_US"), timeZone: losAngeles)
        #expect(note == "Recorded at 6:30\u{202F}PM")
    }

    @Test func namesTheSheetAndItsFields() {
        #expect(EditRecordingText.title == "Edit recording")
        #expect(EditRecordingText.nameHeader == "Name")
        #expect(EditRecordingText.dateHeader == "Date recorded")
        #expect(
            [EditRecordingText.year, EditRecordingText.month, EditRecordingText.day]
                == ["Year", "Month", "Day"])
        #expect(EditRecordingText.any == "Any")
        #expect(EditRecordingText.clearDate == "Clear date")
    }
}
