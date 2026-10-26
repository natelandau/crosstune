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
    func events(since: Int64) async throws -> EventsPage { EventsPage(rows: [], nextSince: since, hasMore: false) }
    func recordNotice(_ notice: PlanNotice) async throws {}
    func refreshBilling() async throws {}
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
    func scanUploadSlot(scanID: String, bytes: Int64) async throws -> SignedURL { throw URLError(.badURL) }
    func scanUploaded(scanID: String) async throws { throw URLError(.badURL) }
    func scanDownload(scanID: String) async throws -> SignedURL { throw URLError(.badURL) }
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
        // The header counts every live recording, whatever the source or search narrows it to.
        #expect(model.countLabel(arrangement) == "3 recordings")
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
        #expect(model.showsFilters)

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
        #expect(model.showsFilters)
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

    @Test func hidesFiltersWithOnlyOwnRecordings() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "mine")
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        #expect(model.sourceOptions == ["all", "own"])
        #expect(!model.showsFilters)
        await model.setChoice("own")
        #expect(model.showsFilters)
        #expect(model.filterCount == 1)
    }

    @Test func hidesFiltersUntilLoadedAndWithNoRecordings() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = RecordingsModel(store: store)
        #expect(!model.showsFilters)
        try await eventually { model.arrangement(.default) != nil }
        #expect(!model.showsFilters)
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

    @Test func measuresStorageAgainstAKnownPlansQuota() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 5, quotaBytes: 1_000, maxFileBytes: 4))
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default) != nil }
        let premium = Plan(kind: .premium, quotaBytes: 50)
        #expect(model.storage(plan: premium) == StorageFigures(usedBytes: 5, quotaBytes: 50, maxFileBytes: 4))
        #expect(model.storage(plan: .unknown)?.quotaBytes == 1_000)
        // Free has no quota to measure against.
        #expect(model.storage(plan: Plan(kind: .free)) == nil)
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

    @Test func arrangesAgainWhenTheRecordingsSourceQueryOrOrderChange() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "b", label: "  Br\u{E9}e jig ", minutes: 1)
        try await putRecording(store, "a", label: "Air", minutes: 2)
        try await putRecording(store, "c", label: "Cove reel", minutes: 3, origin: "slippery_hill")
        let model = RecordingsModel(store: store)
        try await eventually { model.arrangement(.default)?.unfiled.count == 3 }
        let title = RecordingSortChoice(sort: .title, descending: false)

        #expect(model.arrangement(.default)?.unfiled.map(\.id) == ["c", "a", "b"])
        #expect(model.arrangement(title)?.unfiled.map(\.id) == ["a", "b", "c"])
        #expect(model.arrangement(.default)?.unfiled.map(\.id) == ["c", "a", "b"])

        model.query = " BREE "
        #expect(model.arrangement(title)?.unfiled.map(\.id) == ["b"])
        model.query = "\u{300}"
        #expect(model.arrangement(title)?.unfiled.map(\.id) == ["a", "b", "c"])
        model.query = ""

        await model.setChoice("slippery_hill")
        #expect(model.arrangement(title)?.unfiled.map(\.id) == ["c"])
        await model.setChoice(RecordingsModel.allChoice)
        #expect(model.arrangement(title)?.unfiled.map(\.id) == ["a", "b", "c"])

        try await putRecording(store, "d", label: "Ash grove", minutes: 4)
        try await eventually { model.arrangement(title)?.unfiled.map(\.id) == ["a", "d", "b", "c"] }
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
    #if os(macOS)
        @Test func recordingsColumnUsesTheColumnList() throws {
            let file = SourceScan.sources.appending(path: "Recordings/RecordingsScreen.swift")
            let mac = SourceScan.macOSRegions(of: SourceScan.withoutComments(try SourceScan.text(at: file)))
            #expect(mac.contains(".macColumnList()"))
            #expect(!mac.contains(".listStyle(.plain)"))
        }
    #endif

    @Test func aTuneLineIsAControlOfItsOwnBesideTheRow() {
        let row = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), actionLabel: "Play", action: {},
            tuneLine: MediaRow.TuneLine(title: "Soldier's Joy", action: {}))
        #expect(row.controlNames == ["Play Take 1, 1:02", "Open Soldier's Joy"])

        let unfiled = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), actionLabel: "Play", action: {})
        #expect(unfiled.controlNames == ["Play Take 1, 1:02"])
    }

    @Test func drawsItsInnerControlsInReadingOrderWithRetryAtTheTrailingEdge() {
        let row = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), actionLabel: "Play", action: {},
            tuneLine: MediaRow.TuneLine(title: "Soldier's Joy", action: {}),
            retry: MediaRow.Retry(name: "Retry Take 1", action: {}))
        #expect(row.innerControls.map(\.name) == ["Open Soldier's Joy", "Retry Take 1"])
        #expect(row.innerControls.map(\.isTrailing) == [false, true])
        #expect(row.controlNames == ["Play Take 1, 1:02", "Open Soldier's Joy", "Retry Take 1"])
    }

    @Test func anImportsSourceLineComesBeforeTheTuneLine() throws {
        let page = try #require(URL(string: "https://www.slippery-hill.com/content/bear-creek-sally-goodin"))
        let row = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), actionLabel: "Play", action: {},
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
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), actionLabel: "Play", action: {},
            sourceLine: MediaRow.SourceLine(title: "Slippery-Hill", url: page),
            retry: MediaRow.Retry(name: "Retry Take 1", action: {}))
        #expect(!sourceOnly.stacksLineControls, "one line reaches into the row's space without growing it")
        let tuneOnly = MediaRow(
            glyph: .play, title: "Take 1", secondLine: .text("1:02"), actionLabel: "Play", action: {},
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

    @Test func savesNotesPlayersAndAPlaceAndClearsBlankText() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let stored = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let edit = EditRecordingModel(store: store, recording: stored)
        edit.setNotes("  Played it fast.  ")
        #expect(edit.isEdited)
        edit.setPlayers(" Tommy Jarrell ")
        let spot = RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.661_234_5, lon: -80.923_456_7))
        edit.setPlace(spot, method: .search)
        #expect(await edit.save())
        let saved = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        #expect(saved.notes == "Played it fast.")
        #expect(saved.players == "Tommy Jarrell")
        #expect(saved.place == spot)
        #expect(saved.placeAccuracyM == nil)

        let clear = EditRecordingModel(store: store, recording: saved)
        #expect(clear.notes == "Played it fast.")
        #expect(clear.players == "Tommy Jarrell")
        #expect(clear.place == spot)
        clear.setNotes("   ")
        clear.setPlayers("")
        clear.clearPlace()
        #expect(await clear.save())
        let cleared = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        #expect(cleared.notes == nil)
        #expect(cleared.players == nil)
        #expect(cleared.placeName == nil)
        #expect(cleared.placeLat == nil)
        #expect(cleared.placeLon == nil)
    }

    @Test func leavesNotesAndPlayersItDidNotEditForAnEditSyncedMeanwhile() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let opened = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready", notes: "Old notes",
            players: "Tommy Jarrell")
        try await store.write { writer in try writer.put(opened, at: noon) }
        let edit = EditRecordingModel(store: store, recording: opened)
        try await store.write { writer in
            try writer.updateRecording("r1", notes: .value("Synced notes"), players: .value("Fred Cockerham"))
        }
        edit.setName("Jam")
        #expect(await edit.save())
        let saved = try await store.read { db in try Recording.fetchOne(db, key: "r1") }
        #expect(saved?.notes == "Synced notes")
        #expect(saved?.players == "Fred Cockerham")
    }

    @Test func keepsACapturedPlacesAccuracyWhenThePlaceIsLeftAlone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let captured = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready", placeName: "Galax, VA",
            placeLat: 36.66, placeLon: -80.92, placeAccuracyM: 12)
        try await store.write { writer in try writer.put(captured, at: noon) }
        let edit = EditRecordingModel(store: store, recording: captured)
        edit.setName("Jam")
        #expect(await edit.save())
        let saved = try await store.read { db in try Recording.fetchOne(db, key: "r1") }
        #expect(saved?.placeAccuracyM == 12)
    }

    @Test func clearsCoordinatesThatHaveNoName() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let captured = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready", placeLat: 36.66,
            placeLon: -80.92, placeAccuracyM: 12)
        try await store.write { writer in try writer.put(captured, at: noon) }
        let edit = EditRecordingModel(store: store, recording: captured)
        #expect(edit.place == nil)
        #expect(edit.canClearPlace)
        #expect(!edit.isEdited)
        edit.clearPlace()
        #expect(!edit.canClearPlace)
        #expect(edit.isEdited)
        #expect(await edit.save())
        let saved = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        #expect(saved.placeLat == nil)
        #expect(saved.placeLon == nil)
        #expect(saved.placeAccuracyM == nil)
    }

    @Test func offersClearOnlyForAPlaceNamedOrNot() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let bare = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready")
        #expect(!EditRecordingModel(store: store, recording: bare).canClearPlace)
        let named = Recording(
            id: "r2", tuneID: nil, source: "microphone", addedAt: noon, state: "ready", placeName: "Galax, VA",
            placeLat: 36.66, placeLon: -80.92)
        #expect(EditRecordingModel(store: store, recording: named).canClearPlace)
    }

    @Test func loadsPlayerAndPlaceSuggestionsFromEveryRecordingItsOwnIncluded() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let other = Recording(
            id: "r2", tuneID: nil, source: "microphone", addedAt: noon, state: "ready", players: "Tommy Jarrell",
            placeName: "Galax, VA", placeLat: 36.66, placeLon: -80.92)
        let own = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: later(60_000), state: "ready",
            placeName: "Mount Airy, NC", placeLat: 36.5, placeLon: -80.6)
        try await store.write { writer in
            try writer.put(other, at: noon)
            try writer.put(own, at: noon)
        }
        let stored = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let edit = EditRecordingModel(store: store, recording: stored)
        await edit.load()
        #expect(edit.playerOptions == ["Tommy Jarrell"])
        #expect(edit.recentPlaces.map(\.name) == ["Mount Airy, NC", "Galax, VA"])
    }

    @Test func showsANameThatArrivesForUnnamedCoordinatesWithoutCountingAsAnEdit() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let take = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready", placeLat: 36.66,
            placeLon: -80.92, placeAccuracyM: 14)
        try await store.write { writer in try writer.put(take, at: noon) }
        let edit = EditRecordingModel(store: store, recording: take)
        await edit.load()
        #expect(edit.place == nil)

        var named = take
        named.placeName = "Galax, VA"
        let synced = named
        try await store.write { writer in try writer.put(synced, at: later(1_000)) }

        #expect(try await poll { edit.place?.name == "Galax, VA" })
        #expect(!edit.isEdited)
        #expect(edit.canClearPlace)
        edit.setName("Jam")
        #expect(await edit.save())
        let saved = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        #expect(saved.placeName == "Galax, VA")
        #expect(saved.placeAccuracyM == 14)
    }

    @Test func thePlaceSearchShowsANameThatArrivesWhileItIsOpen() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let take = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready", placeLat: 36.66,
            placeLon: -80.92, placeAccuracyM: 14)
        try await store.write { writer in try writer.put(take, at: noon) }
        let edit = EditRecordingModel(store: store, recording: take)
        let galax = RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.66, lon: -80.92))
        let search = PlaceSearchModel(edit: edit, search: { FakePlaceSearch() })
        #expect(search.current == nil)
        #expect(!search.isCurrent(galax))

        var named = take
        named.placeName = "Galax, VA"
        let synced = named
        try await store.write { writer in try writer.put(synced, at: later(1_000)) }

        #expect(try await poll { search.current?.name == "Galax, VA" })
        #expect(search.isCurrent(galax))
    }

    @Test func aNameThatArrivesAfterAPickOrAClearChangesNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let take = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready", placeLat: 36.66,
            placeLon: -80.92, placeAccuracyM: 14)
        try await store.write { writer in try writer.put(take, at: noon) }
        let picked = EditRecordingModel(store: store, recording: take)
        let cleared = EditRecordingModel(store: store, recording: take)
        await picked.load()
        await cleared.load()
        let spot = RecordingPlace(name: "Ennis, Ireland", coordinate: Coordinate(lat: 52.84, lon: -8.98))
        picked.setPlace(spot, method: .search)
        cleared.clearPlace()

        var named = take
        named.placeName = "Galax, VA"
        let synced = named
        try await store.write { writer in try writer.put(synced, at: later(1_000)) }
        let watcher = EditRecordingModel(store: store, recording: take)
        #expect(try await poll { watcher.place?.name == "Galax, VA" })

        #expect(picked.place == spot)
        #expect(cleared.place == nil)
        #expect(!cleared.canClearPlace)
        #expect(cleared.isEdited)
    }

    @Test func takesAPickAndAClearFromThePlaceSearch() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let stored = try #require(try await store.read { db in try Recording.fetchOne(db, key: "r1") })
        let edit = EditRecordingModel(store: store, recording: stored)
        let spot = RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.66, lon: -80.92))
        let search = PlaceSearchModel(edit: edit, search: { FakePlaceSearch() })
        #expect(search.pickRecent(spot))
        #expect(edit.place == spot)
        #expect(edit.placeMethod == .suggestion)
        #expect(edit.isEdited)
        let clearing = PlaceSearchModel(edit: edit, search: { FakePlaceSearch() })
        #expect(clearing.clear())
        #expect(edit.place == nil)
        #expect(edit.placeMethod == nil)
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

    @Test func addToTuneListsTheCatalogWhenIdle() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        _ = try await commands.createTune(TuneInput(title: "Kitchen Girl"), userTune: UserTuneInput(status: "known"))
        _ = try await commands.createTune(
            TuneInput(title: "Ashokan Farewell"), userTune: UserTuneInput(status: "learning"))
        let archived = try await commands.createTune(
            TuneInput(title: "Big Scioty"), userTune: UserTuneInput(status: "known"))
        try await commands.setArchived(archived.userTuneID, archived: true)
        try await putRecording(store, "r1")
        let model = AddToTuneModel(store: store, recordingID: "r1")
        try await eventually { model.idleResults != nil }
        #expect(model.idleResults?.map(\.tune.title) == ["Ashokan Farewell", "Big Scioty", "Kitchen Girl"])
        model.query = "kitchen"
        #expect(model.idleResults?.isEmpty == true, "typing hands the rows to the search")
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

/// The location page's picks, which the edit sheet holds until Save and writes in one go.
@MainActor
@Suite struct LocationPickTests {
    private let spot = Coordinate(lat: 36.66, lon: -80.92, accuracyM: 12)
    private let street = "1 Main St, Galax, VA"

    private func put(_ store: CrosstuneStore, _ recordings: [Recording], places: [SavedPlace] = []) async throws {
        try await store.write { writer in
            for place in places { try writer.put(place, at: noon) }
            for recording in recordings { try writer.put(recording, at: noon) }
        }
    }

    private func captured(_ id: String = "r1", name: String? = nil, placeID: String? = nil) -> Recording {
        Recording(
            id: id, tuneID: nil, source: "microphone", addedAt: noon, state: "ready", placeName: name,
            placeLat: spot.lat, placeLon: spot.lon, placeAccuracyM: spot.accuracyM, placeID: placeID,
            placeOrigin: "device")
    }

    private func stored(_ store: CrosstuneStore, _ id: String = "r1") async throws -> Recording {
        try #require(try await store.read { db in try Recording.fetchOne(db, key: id) })
    }

    private func savedPlaces(_ store: CrosstuneStore) async throws -> [SavedPlace] {
        try await store.read { db in try SavedPlace.fetchAll(db) }
    }

    @Test func namingCreatesASavedPlaceAndLinksTheTake() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let take = captured(name: street)
        try await put(store, [take])
        let edit = EditRecordingModel(store: store, recording: take, analytics: sink.client)
        await edit.load()
        #expect(edit.canNamePlace)
        edit.nameLocation("  Tom’s kitchen  ")
        #expect(edit.place?.name == "Tom’s kitchen")
        #expect(edit.placeAddress == street)
        #expect(edit.isEdited)
        #expect(try await savedPlaces(store).isEmpty)

        #expect(await edit.save())
        let place = try #require(try await savedPlaces(store).first)
        #expect(place.name == "Tom’s kitchen")
        #expect(place.address == street)
        #expect(place.lat == spot.lat && place.lon == spot.lon)
        let saved = try await stored(store)
        #expect(saved.placeID == place.id)
        #expect(saved.placeOrigin == "picked")
        #expect(saved.placeName == street)
        #expect(saved.placeAccuracyM == 12)
        #expect(
            sink.captures.map(\.name).sorted() == ["recording_place_set", "saved_location_created"])
        #expect(
            sink.captures.first { $0.name == "saved_location_created" }?.properties == ["method": .string("custom")])
        #expect(sink.captures.first { $0.name == "recording_place_set" }?.properties["method"] == .string("saved"))
    }

    @Test func namingOnALinkedTakeRelinksOnlyThatTake() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let barn = SavedPlace(id: "p1", createdAt: noon, name: "The barn", lat: spot.lat, lon: spot.lon)
        let take = captured("r1", name: street, placeID: "p1")
        try await put(store, [take, captured("r2", name: street, placeID: "p1")], places: [barn])
        let edit = EditRecordingModel(store: store, recording: take)
        await edit.load()
        #expect(try await poll { edit.place?.name == "The barn" })
        edit.nameLocation("Upstairs flat")
        #expect(await edit.save())
        let places = try await savedPlaces(store)
        let flat = try #require(places.first { $0.name == "Upstairs flat" })
        #expect(places.first { $0.id == "p1" }?.name == "The barn")
        #expect(try await stored(store, "r1").placeID == flat.id)
        #expect(try await stored(store, "r2").placeID == "p1")
    }

    @Test func pickingAVenueCreatesASavedPlace() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let take = captured(name: street)
        try await put(store, [take])
        let edit = EditRecordingModel(store: store, recording: take, analytics: sink.client)
        await edit.load()
        let venue = NearbyPlace(
            name: "Rex Theater", address: "113 E Grayson St, Galax, VA", lat: 36.660_3, lon: -80.920_1,
            applePlaceID: "I1234")
        edit.pickNearby(.venue(venue))
        #expect(edit.place?.name == "Rex Theater")
        #expect(edit.placeAddress == "113 E Grayson St, Galax, VA")
        #expect(edit.placeMethod == .nearby)
        #expect(await edit.save())

        let place = try #require(try await savedPlaces(store).first)
        #expect(place.name == "Rex Theater")
        #expect(place.address == "113 E Grayson St, Galax, VA")
        #expect(place.lat == venue.lat && place.lon == venue.lon)
        #expect(place.applePlaceID == "I1234")
        let saved = try await stored(store)
        #expect(saved.placeID == place.id)
        #expect(saved.placeLat == spot.lat && saved.placeLon == spot.lon)
        #expect(saved.placeAccuracyM == 12)
        #expect(saved.placeName == street)
        #expect(
            sink.captures.first { $0.name == "saved_location_created" }?.properties == ["method": .string("nearby")])
        #expect(sink.captures.first { $0.name == "recording_place_set" }?.properties["method"] == .string("nearby"))
    }

    @Test func pickingASearchedVenueCreatesASavedPlaceAndMovesTheTake() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let take = captured(name: street)
        try await put(store, [take])
        let edit = EditRecordingModel(store: store, recording: take, analytics: sink.client)
        let jalopy = RecordingPlace(
            name: "Jalopy Theatre, 315 Columbia St, Brooklyn, NY", coordinate: Coordinate(lat: 40.684_5, lon: -74.001_9)
        )
        edit.pickSearch(
            PickedPlace(
                place: jalopy,
                saving: SavedPlaceDraft(
                    name: "Jalopy Theatre", address: "315 Columbia St, Brooklyn, NY", lat: 40.684_5, lon: -74.001_9,
                    applePlaceID: "J1")))
        #expect(await edit.save())
        let place = try #require(try await savedPlaces(store).first)
        #expect(place.name == "Jalopy Theatre")
        #expect(place.applePlaceID == "J1")
        let saved = try await stored(store)
        #expect(saved.place == jalopy)
        #expect(saved.placeID == place.id)
        #expect(
            sink.captures.first { $0.name == "saved_location_created" }?.properties == ["method": .string("search")])
    }

    @Test func pickingATownCreatesNoSavedPlace() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let take = captured(name: street)
        try await put(store, [take])
        let edit = EditRecordingModel(store: store, recording: take, analytics: sink.client)
        let town = RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.661, lon: -80.923))
        edit.pickSearch(PickedPlace(place: town, saving: nil))
        #expect(await edit.save())
        #expect(try await savedPlaces(store).isEmpty)
        let saved = try await stored(store)
        #expect(saved.place == town)
        #expect(saved.placeID == nil)
        #expect(saved.placeOrigin == "picked")
        #expect(sink.captures.map(\.name) == ["recording_place_set"])
    }

    @Test func aPickAndTheSavedPlaceItMakesWaitForSave() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let take = captured(name: street)
        try await put(store, [take])
        let before = try await stored(store)
        let edit = EditRecordingModel(store: store, recording: before)
        edit.pickNearby(
            .venue(NearbyPlace(name: "Rex Theater", address: nil, lat: 36.660_3, lon: -80.920_1, applePlaceID: nil)))
        edit.nameLocation("Tom’s kitchen")
        #expect(try await savedPlaces(store).isEmpty)
        #expect(try await stored(store) == before)
    }

    @Test func linkedTakeWithoutItsOwnNameShowsTheSavedName() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let barn = SavedPlace(
            id: "p1", createdAt: noon, name: "The barn", lat: spot.lat, lon: spot.lon, address: street)
        let take = captured(placeID: "p1")
        try await put(store, [take], places: [barn])
        let edit = EditRecordingModel(store: store, recording: take)
        await edit.load()
        #expect(try await poll { edit.place?.name == "The barn" })
        #expect(edit.placeAddress == street)
        #expect(edit.canClearPlace)
        #expect(!edit.isEdited)
        edit.setName("Jam")
        #expect(await edit.save())
        let saved = try await stored(store)
        #expect(saved.placeID == "p1")
        #expect(saved.placeName == nil)
        #expect(saved.placeAccuracyM == 12)
    }

    private let jalopy = RecordingPlace(
        name: "Jalopy Theatre, 315 Columbia St, Brooklyn, NY", coordinate: Coordinate(lat: 40.684_5, lon: -74.001_9))

    @Test func namingOverAStagedSearchPickSavesAtThePickedPoint() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let take = captured(name: street)
        try await put(store, [take])
        let edit = EditRecordingModel(store: store, recording: take)
        await edit.load()
        edit.pickSearch(PickedPlace(place: jalopy, saving: nil))
        #expect(edit.placeCoordinate == jalopy.coordinate)
        #expect(edit.mapsPoint == jalopy.coordinate)
        edit.nameLocation("Back room")
        #expect(edit.placeCoordinate == jalopy.coordinate)
        #expect(await edit.save())
        let place = try #require(try await savedPlaces(store).first)
        let saved = try await stored(store)
        #expect(place.lat == jalopy.coordinate.lat && place.lon == jalopy.coordinate.lon)
        #expect(saved.placeLat == place.lat && saved.placeLon == place.lon)
        #expect(saved.placeAccuracyM == nil)
        #expect(saved.placeID == place.id)
        #expect(saved.placeName == jalopy.name)
    }

    @Test func aNearbyVenueOverAStagedSearchPickKeepsThePickedPoint() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let take = captured(name: street)
        try await put(store, [take])
        let edit = EditRecordingModel(store: store, recording: take)
        await edit.load()
        edit.pickSearch(PickedPlace(place: jalopy, saving: nil))
        let venue = NearbyPlace(
            name: "Pete’s Candy Store", address: "709 Lorimer St, Brooklyn, NY", lat: 40.684_6, lon: -74.001_8,
            applePlaceID: "P1")
        edit.pickNearby(.venue(venue))
        #expect(edit.placeCoordinate == jalopy.coordinate)
        #expect(await edit.save())
        let place = try #require(try await savedPlaces(store).first)
        #expect(place.lat == venue.lat && place.lon == venue.lon)
        let saved = try await stored(store)
        #expect(saved.placeLat == jalopy.coordinate.lat && saved.placeLon == jalopy.coordinate.lon)
        #expect(saved.placeID == place.id)
    }

    @Test func aSearchPickOfAVenueSavedAlreadyLinksIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let existing = SavedPlace(
            id: "p1", createdAt: noon, name: "Jalopy", lat: 40.684_5, lon: -74.001_9, applePlaceID: "J1")
        let take = captured(name: street)
        try await put(store, [take], places: [existing])
        let edit = EditRecordingModel(store: store, recording: take)
        await edit.load()
        #expect(try await poll { !edit.savedPlaces.isEmpty })
        edit.pickSearch(
            PickedPlace(
                place: jalopy,
                saving: SavedPlaceDraft(
                    name: "Jalopy Theatre", address: "315 Columbia St, Brooklyn, NY", lat: 40.684_5, lon: -74.001_9,
                    applePlaceID: "J1")))
        #expect(edit.place?.name == "Jalopy")
        #expect(await edit.save())
        #expect(try await savedPlaces(store).map(\.id) == ["p1"])
        let saved = try await stored(store)
        #expect(saved.placeID == "p1")
        #expect(saved.place == jalopy)
    }

    @Test func namingATakePickedAsAVenueKeepsNoAddress() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let take = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready", placeName: jalopy.name,
            placeLat: jalopy.coordinate.lat, placeLon: jalopy.coordinate.lon, placeOrigin: "picked")
        try await put(store, [take])
        let edit = EditRecordingModel(store: store, recording: take)
        await edit.load()
        edit.nameLocation("Back room")
        #expect(edit.placeAddress == nil)
        #expect(await edit.save())
        #expect(try await savedPlaces(store).first?.address == nil)
    }

    @Test func aStreetAddressSearchPickNamedKeepsItsAddressLine() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let take = captured(name: street)
        try await put(store, [take])
        let edit = EditRecordingModel(store: store, recording: take)
        let center = RecordingPlace(name: "1038 Center St, Newton, MA", coordinate: Coordinate(lat: 42.33, lon: -71.2))
        edit.pickSearch(
            PickedPlace(
                place: center,
                saving: SavedPlaceDraft(name: center.name, address: nil, lat: 42.33, lon: -71.2, applePlaceID: nil)))
        edit.nameLocation("Grandma’s")
        #expect(edit.placeAddress == center.name)
    }

    @Test func aPickedSavedPlaceDeletedMeanwhileFallsBackToTheTakesOwn() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let barn = SavedPlace(id: "p1", createdAt: noon, name: "The barn", lat: spot.lat, lon: spot.lon)
        let take = captured(name: street)
        try await put(store, [take], places: [barn])
        let edit = EditRecordingModel(store: store, recording: take)
        await edit.load()
        edit.pickSaved(barn)
        #expect(try await poll { edit.place?.name == "The barn" })
        try await store.write { writer in try writer.deleteSavedPlace("p1", at: later(1_000)) }
        #expect(try await poll { edit.place?.name == street })
        #expect(!edit.isEdited)
        edit.setName("Jam")
        #expect(await edit.save())
        let saved = try await stored(store)
        #expect(saved.placeID == nil)
        #expect(saved.placeAccuracyM == 12)
    }

    @Test func aSavedPickOverAStagedSearchPickKeepsTheTakesOwn() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let barn = SavedPlace(id: "p1", createdAt: noon, name: "The barn", lat: 36.67, lon: -80.93)
        let take = captured(name: street)
        try await put(store, [take], places: [barn])
        let edit = EditRecordingModel(store: store, recording: take)
        await edit.load()
        edit.pickSearch(PickedPlace(place: jalopy, saving: nil))
        edit.pickSaved(barn)
        #expect(edit.placeCoordinate == spot)
        #expect(await edit.save())
        let saved = try await stored(store)
        #expect(saved.placeLat == spot.lat && saved.placeLon == spot.lon)
        #expect(saved.placeAccuracyM == 12)
        #expect(saved.placeName == street)
        #expect(saved.placeID == "p1")
    }

    @Test func aLinkOverAPickWhoseLocationIsDeletedFallsBackToThePick() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let barn = SavedPlace(id: "p1", createdAt: noon, name: "The barn", lat: 40.684_6, lon: -74.001_8)
        let take = captured(name: street)
        try await put(store, [take], places: [barn])
        let edit = EditRecordingModel(store: store, recording: take, analytics: sink.client)
        await edit.load()
        edit.pickSearch(PickedPlace(place: jalopy, saving: nil))
        edit.pickNearby(.saved(barn))
        #expect(try await poll { edit.place?.name == "The barn" })
        try await store.write { writer in try writer.deleteSavedPlace("p1", at: later(1_000)) }
        #expect(try await poll { edit.place == jalopy })
        #expect(edit.isEdited)
        #expect(await edit.save())
        let saved = try await stored(store)
        #expect(saved.place == jalopy)
        #expect(saved.placeID == nil)
        // The search pick is what was written, so it is what the event says.
        #expect(sink.captures.first { $0.name == "recording_place_set" }?.properties["method"] == .string("search"))
    }

    @Test func aSearchPickLinkedToASavedPlaceDeletedMeanwhileSavesItsOwn() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let existing = SavedPlace(
            id: "p1", createdAt: noon, name: "Jalopy", lat: 40.684_5, lon: -74.001_9, applePlaceID: "J1")
        let take = captured(name: street)
        try await put(store, [take], places: [existing])
        let edit = EditRecordingModel(store: store, recording: take, analytics: sink.client)
        await edit.load()
        #expect(try await poll { !edit.savedPlaces.isEmpty })
        edit.pickSearch(
            PickedPlace(
                place: jalopy,
                saving: SavedPlaceDraft(
                    name: "Jalopy Theatre", address: "315 Columbia St, Brooklyn, NY", lat: 40.684_5, lon: -74.001_9,
                    applePlaceID: "J1")))
        #expect(try await poll { edit.linkedPlace?.id == "p1" })
        try await store.write { writer in try writer.deleteSavedPlace("p1", at: later(1_000)) }
        #expect(try await poll { edit.linkedPlace == nil })
        #expect(edit.place == jalopy)
        #expect(await edit.save())
        let made = try #require(try await savedPlaces(store).first { $0.deletedAt == nil })
        #expect(made.name == "Jalopy Theatre")
        #expect(made.address == "315 Columbia St, Brooklyn, NY")
        let saved = try await stored(store)
        #expect(saved.place == jalopy)
        #expect(saved.placeID == made.id)
        #expect(
            sink.captures.first { $0.name == "saved_location_created" }?.properties == ["method": .string("search")])
    }

    @Test func aSearchPickWithAnAppleIDLinksASavedPlaceOfItsNameThatHasNone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        // Saved on a client whose search gives no Apple id, about 11 m north of the pick.
        let existing = SavedPlace(
            id: "p1", createdAt: noon, name: "  jalopy THEATRE ", lat: 40.684_6, lon: -74.001_9)
        let take = captured(name: street)
        try await put(store, [take], places: [existing])
        let edit = EditRecordingModel(store: store, recording: take)
        edit.pickSearch(
            PickedPlace(
                place: jalopy,
                saving: SavedPlaceDraft(
                    name: "Jalopy Theatre", address: nil, lat: 40.684_5, lon: -74.001_9, applePlaceID: "J1")))
        #expect(await edit.save())
        #expect(try await savedPlaces(store).map(\.id) == ["p1"])
        #expect(try await stored(store).placeID == "p1")
    }

    @Test func aNearbyVenueOrATypedNameSavedAlreadyLinksThatPlace() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let barn = SavedPlace(id: "p1", createdAt: noon, name: "The Barn", lat: spot.lat, lon: spot.lon)
        let take = captured(name: street)
        try await put(store, [take], places: [barn])

        let venue = EditRecordingModel(store: store, recording: take, analytics: sink.client)
        venue.pickNearby(
            .venue(NearbyPlace(name: "the barn", address: nil, lat: spot.lat, lon: spot.lon, applePlaceID: "B1")))
        #expect(await venue.save())
        #expect(try await savedPlaces(store).map(\.id) == ["p1"])
        #expect(try await stored(store).placeID == "p1")

        let named = EditRecordingModel(store: store, recording: try await stored(store), analytics: sink.client)
        await named.load()
        named.nameLocation(" THE BARN ")
        #expect(await named.save())
        #expect(try await savedPlaces(store).map(\.id) == ["p1"])
        #expect(!sink.captures.map(\.name).contains("saved_location_created"))
    }

    @Test func aSearchPickBeforeTheSavedPlacesAreReadStillLinksASavedVenue() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let existing = SavedPlace(
            id: "p1", createdAt: noon, name: "Jalopy", lat: 40.684_5, lon: -74.001_9, applePlaceID: "J1")
        let take = captured(name: street)
        try await put(store, [take], places: [existing])
        let edit = EditRecordingModel(store: store, recording: take, analytics: sink.client)
        #expect(edit.savedPlaces.isEmpty)
        edit.pickSearch(
            PickedPlace(
                place: jalopy,
                saving: SavedPlaceDraft(
                    name: "Jalopy Theatre", address: nil, lat: 40.684_5, lon: -74.001_9, applePlaceID: "J1")))
        #expect(await edit.save())
        #expect(try await savedPlaces(store).map(\.id) == ["p1"])
        #expect(try await stored(store).placeID == "p1")
        #expect(!sink.captures.map(\.name).contains("saved_location_created"))
    }

    @Test func replacedReadsTheCurrentLocation() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let sink = RecordingAnalyticsSink()
        let take = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready")
        try await put(store, [take])
        let edit = EditRecordingModel(store: store, recording: take, analytics: sink.client)
        var named = take
        named.placeName = street
        named.placeLat = spot.lat
        named.placeLon = spot.lon
        let synced = named
        try await store.write { writer in try writer.put(synced, at: later(1_000)) }
        #expect(try await poll { edit.place?.name == street })
        edit.pickSearch(PickedPlace(place: jalopy, saving: nil))
        #expect(await edit.save())
        #expect(sink.captures.first { $0.name == "recording_place_set" }?.properties["replaced"] == .bool(true))
    }

    @Test func aLinkedTakeLeavesTheRecentLocations() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let barn = SavedPlace(id: "p1", createdAt: noon, name: "The barn", lat: spot.lat, lon: spot.lon)
        let other = Recording(
            id: "r2", tuneID: nil, source: "microphone", addedAt: later(60_000), state: "ready", placeName: "Galax, VA",
            placeLat: 36.661, placeLon: -80.923, placeOrigin: "picked")
        try await put(store, [captured("r1", name: street, placeID: "p1"), other], places: [barn])
        let edit = EditRecordingModel(store: store, recording: other)
        await edit.load()
        #expect(edit.recentPlaces.map(\.name) == ["Galax, VA"])
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

    /// The group heading's note asks this of each row, so it shows only where a row has it.
    @Test func onlyARowOfferingPlayIsStoodDownByATake() {
        let recording = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready")
        let held = RecordingFile(id: "r1", localState: .downloaded, fileName: "r1.m4a")
        #expect(RecordingRowContent.blocksPlay(recording, file: held, loaded: false, downloading: false))
        #expect(!RecordingRowContent.blocksPlay(recording, file: held, loaded: true, downloading: false))
        #expect(!RecordingRowContent.blocksPlay(recording, file: nil, loaded: false, downloading: false))
        // The row and the heading agree.
        let row = RecordingRowContent(recording: recording, file: held, tuneTitle: nil, playBlocked: true)
        #expect(
            (row.notice != nil)
                == RecordingRowContent.blocksPlay(
                    recording, file: held, loaded: false, downloading: false))
    }

    @Test func asksToDeleteAnUnfinishedCaptureWhenItsRowIsTapped() {
        let capture = RecordingFile(id: "c1", localState: .capturing, recordedAt: noon)
        let row = UnfinishedCaptureRowContent(
            capture: capture, locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "UTC")!)
        #expect(row.actionLabel == RecordingRowActions.delete)
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

@Suite struct RecordingsSectionOrderTests {
    @Test func storageSummaryFollowsTheGroups() {
        #expect(
            RecordingArrangement.sectionOrder(hasUnfinished: true, hasUnfiled: true, tuneCount: 2)
                == [.unfinished, .unfiled, .tunes, .storage])
        #expect(
            RecordingArrangement.sectionOrder(hasUnfinished: false, hasUnfiled: true, tuneCount: 0)
                == [.unfiled, .storage])
        #expect(
            RecordingArrangement.sectionOrder(hasUnfinished: true, hasUnfiled: false, tuneCount: 1)
                == [.unfinished, .tunes, .storage])
        #expect(
            RecordingArrangement.sectionOrder(hasUnfinished: false, hasUnfiled: false, tuneCount: 0) == [.storage])
        #expect(
            RecordingArrangement.sectionOrder(
                hasUnfinished: true, hasUnfiled: false, tuneCount: 0, narrowedToNothing: true)
                == [.unfinished, .count, .storage])
    }

    @Test func theStorageRowHidesForAnEmptyState() {
        #expect(
            RecordingArrangement.sectionOrder(
                hasUnfinished: false, hasUnfiled: false, tuneCount: 0, showsEmptyState: true)
                == [])
        #expect(
            RecordingArrangement.sectionOrder(
                hasUnfinished: false, hasUnfiled: false, tuneCount: 0, narrowedToNothing: true, showsEmptyState: true)
                == [.count])
    }
}

@Suite struct RecordingRowOpensScreenTests {
    private let recording = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready")
    private let held = RecordingFile(id: "r1", localState: .downloaded, fileName: "r1.m4a")

    @Test func aRowThatOpensTheScreenSaysOpen() {
        let row = RecordingRowContent(recording: recording, file: held, tuneTitle: nil, opensScreen: true)
        #expect(row.actionLabel == MediaText.open)
        #expect(row.glyph == .play)
        #expect(row.tap == .open)
    }

    @Test func theLoadedRowThatOpensTheScreenNeverShowsStop() {
        let row = RecordingRowContent(recording: recording, file: held, tuneTitle: nil, loaded: true, opensScreen: true)
        #expect(row.actionLabel == MediaText.open)
        #expect(row.glyph == .play)
        #expect(row.tap == .open)
    }

    @Test func aDownloadRowThatOpensTheScreenStillDownloads() {
        let row = RecordingRowContent(recording: recording, file: nil, tuneTitle: nil, opensScreen: true)
        #expect(row.actionLabel == RecordingRowContent.download)
        #expect(row.tap == .download)
    }
}

@Suite struct RecordingRowPremiumTests {
    private let recording = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready")
    private let held = RecordingFile(id: "r1", localState: .downloaded, fileName: "r1.m4a")

    @Test func aFreePlanDimsTheRowAndSendsItsTapToTheGate() {
        let row = RecordingRowContent(recording: recording, file: held, tuneTitle: nil, recordingsPlay: false)
        #expect(row.isDimmed)
        #expect(row.tap == .premium)
        let opens = RecordingRowContent(
            recording: recording, file: held, tuneTitle: nil, opensScreen: true, recordingsPlay: false)
        #expect(opens.isDimmed && opens.tap == .premium)
    }

    @Test func theGatedRowsWordsMatchTheWeb() {
        #expect(RecordingText.subscribeToPlay == "Subscribe to play")
    }

    @MainActor
    @Test func aFreePlanSpeaksNoActionLabelAndNamesPremium() {
        let title = RecordingText.title(recording, tuneTitle: nil)
        for file in [held, nil] {
            let row = RecordingRowContent(recording: recording, file: file, tuneTitle: nil, recordingsPlay: false)
            #expect(row.actionLabel == nil)
            #expect(row.spokenNotice == RecordingText.subscribeToPlay)
            let names = MediaRow(recording: row, perform: { _ in }, onRetry: { _ in }).controlNames
            #expect(names == ["\(title), \(row.meta), \(RecordingText.subscribeToPlay)"])
        }
        let plays = RecordingRowContent(recording: recording, file: held, tuneTitle: nil, recordingsPlay: true)
        #expect(plays.actionLabel == MediaText.play && plays.spokenNotice == nil)
    }

    @Test func aFreePlanNeverDownloadsFromATap() {
        let row = RecordingRowContent(recording: recording, file: nil, tuneTitle: nil, recordingsPlay: false)
        #expect(row.isDimmed)
        #expect(row.tap == .premium)
    }

    @Test func aStuckUploadStillRetriesOnAFreePlan() {
        let stuck = RecordingFile(id: "r1", localState: .failedUpload)
        let pending = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "pending")
        let row = RecordingRowContent(recording: pending, file: stuck, tuneTitle: nil, recordingsPlay: false)
        #expect(row.tap == .retry(.upload))
    }

    @Test func aPlanThatPlaysLeavesTheRowAsItWas() {
        let row = RecordingRowContent(recording: recording, file: held, tuneTitle: nil, recordingsPlay: true)
        #expect(!row.isDimmed)
        #expect(row.tap == .play)
    }

    @Test func theRecordingsLineCountsTheRecordings() {
        #expect(RecordingText.recordingsLine(count: 1) == "1 recording, subscribe to play")
        #expect(RecordingText.recordingsLine(count: 3) == "3 recordings, subscribe to play")
        #expect(RecordingText.recordingsLineExpanded == "Expanded")
        #expect(RecordingText.recordingsLineCollapsed == "Collapsed")
    }
}

@Suite struct RecordingSuggestionsTests {
    private func placed(
        _ id: String, _ name: String?, minutes: Int64, lat: Double = 36.66, lon: Double = -80.92,
        accuracyM: Int? = nil, deleted: Bool = false
    ) -> Recording {
        var recording = Recording(
            id: id, tuneID: nil, source: "microphone", addedAt: later(minutes * 60_000), state: "ready",
            placeName: name, placeLat: lat, placeLon: lon, placeAccuracyM: accuracyM)
        if deleted { recording.deletedAt = noon }
        return recording
    }

    private func players(_ id: String, _ players: String?, deleted: Bool = false) -> Recording {
        var recording = Recording(id: id, tuneID: nil, source: "microphone", addedAt: noon, players: players)
        if deleted { recording.deletedAt = noon }
        return recording
    }

    @Test func listsEachPlaceOnceMostRecentlyAddedFirstWithoutAccuracy() {
        let recordings = [
            placed("a", "Galax, VA", minutes: 1, accuracyM: 12),
            placed("b", "Mount Airy, NC", minutes: 3, lat: 36.5, lon: -80.6),
            placed("c", "Galax, VA", minutes: 2),
        ]
        #expect(
            RecordingSuggestions.recentPlaces(recordings) == [
                RecordingPlace(name: "Mount Airy, NC", coordinate: Coordinate(lat: 36.5, lon: -80.6)),
                RecordingPlace(name: "Galax, VA", coordinate: Coordinate(lat: 36.66, lon: -80.92)),
            ])
    }

    @Test func keepsOneNameAtTwoSpotsApart() {
        let recordings = [
            placed("a", "Springfield, IL", minutes: 1, lat: 39.8),
            placed("b", "Springfield, MO", minutes: 2, lat: 37.2),
            placed("c", "Springfield, IL", minutes: 3, lat: 37.2),
        ]
        let places = RecordingSuggestions.recentPlaces(recordings)
        #expect(places.map(\.name) == ["Springfield, IL", "Springfield, MO", "Springfield, IL"])
        #expect(places.map(\.coordinate.lat) == [37.2, 37.2, 39.8])
    }

    @Test func skipsUnnamedAndDeletedButKeepsEveryLiveRecordingsPlace() {
        let recordings = [
            placed("a", nil, minutes: 4),
            placed("b", "Floyd, VA", minutes: 3, deleted: true),
            placed("c", "Hillsville, VA", minutes: 2),
            placed("d", "Galax, VA", minutes: 1),
        ]
        #expect(RecordingSuggestions.recentPlaces(recordings).map(\.name) == ["Hillsville, VA", "Galax, VA"])
    }

    @Test func foldsPlayersTrimsAndSortsByName() {
        let recordings = [
            players("a", "kevin"), players("b", " Kevin "), players("c", "Kevin"), players("d", "Alice and Tom"),
            players("e", "  "), players("f", nil), players("g", "Zed", deleted: true),
        ]
        #expect(RecordingSuggestions.players(recordings) == ["Alice and Tom", "Kevin"])
    }
}
