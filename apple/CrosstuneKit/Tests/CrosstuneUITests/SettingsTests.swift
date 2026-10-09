import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import GRDB
import Testing

@testable import CrosstuneSync
@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: @MainActor () async throws -> Bool) async throws {
    if try await poll({ try await condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}

/// A server that answers nothing, for an engine whose transfer pass the test counts.
private struct SilentSyncAPI: SyncAPI {
    func push(_ changes: [Change]) async throws -> [PushResult] { [] }
    func pull(since: Int64) async throws -> PullPage { PullPage(rows: [], nextSince: since, hasMore: false) }
    func events(since: Int64) async throws -> EventsPage { EventsPage(rows: [], nextSince: since, hasMore: false) }
    func storage() async throws -> StorageFigures { StorageFigures(usedBytes: 0, quotaBytes: 0, maxFileBytes: 0) }
    func resolveLink(url: String) async throws -> ResolvedLink { throw URLError(.badURL) }
    func searchRecordings(q: String, providers: [String], country: String) async throws -> SearchResponse {
        throw URLError(.badURL)
    }
    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
        throw URLError(.badURL)
    }
    func uploadFinished(recordingID: String) async throws { throw URLError(.badURL) }
    func downloadURL(recordingID: String) async throws -> DownloadURL { throw URLError(.badURL) }
    func peaksURL(recordingID: String) async throws -> PeaksURL { throw URLError(.badURL) }
    func retryRecording(recordingID: String) async throws { throw URLError(.badURL) }
    func scanUploadSlot(scanID: String, bytes: Int64) async throws -> SignedURL { throw URLError(.badURL) }
    func scanUploaded(scanID: String) async throws { throw URLError(.badURL) }
    func scanDownload(scanID: String) async throws -> SignedURL { throw URLError(.badURL) }
    func putObject(_ url: URL, file: URL, contentType: String) async throws { throw URLError(.badURL) }
    func getObject(_ url: URL, to destination: URL) async throws { throw URLError(.badURL) }
}

@MainActor
private final class TransferCounter {
    var count = 0
}

@MainActor
private func loadedModel(_ store: CrosstuneStore, engine: SyncEngine? = nil) async throws -> SettingsModel {
    let model = SettingsModel(store: store, engine: engine)
    try await eventually { model.isLoaded }
    return model
}

private func storedSettings(_ store: CrosstuneStore) async throws -> UserSettings? {
    try await store.read { db in try UserSettings.fetchOne(db, key: settingsID(clerkUserID: store.userID)) }
}

@Suite struct PendingWriteTests {
    @Test func coversTheStoredValueUntilTheStoreReadsTheWrite() {
        var pending = PendingWrite<Bool>()
        let token = pending.begin(true)
        #expect(pending.value == true)
        pending.land(token, stored: false)
        #expect(pending.value == true)
        pending.storeChanged()
        #expect(pending.value == nil)
    }

    @Test func stepsAsideAtOnceWhenTheStoreAlreadyShowsTheWrite() {
        var pending = PendingWrite<String>()
        let token = pending.begin("high")
        pending.land(token, stored: "high")
        #expect(pending.value == nil)
    }

    @Test func ignoresAReadBeforeTheWriteHasLanded() {
        var pending = PendingWrite<Bool>()
        _ = pending.begin(true)
        pending.storeChanged()
        #expect(pending.value == true)
    }

    @Test func dropsAFailedWrite() {
        var pending = PendingWrite<Bool>()
        let token = pending.begin(true)
        let wasLatest = pending.fail(token)
        #expect(wasLatest)
        #expect(pending.value == nil)
    }

    @Test func neverLetsAnEarlierWriteSettleALaterOne() {
        var pending = PendingWrite<Bool>()
        let first = pending.begin(true)
        _ = pending.begin(false)
        let firstWasLatest = pending.fail(first)
        #expect(!firstWasLatest)
        #expect(pending.value == false)
        pending.land(first, stored: false)
        #expect(pending.value == false)
    }
}

@Suite struct TextSizeStepperTests {
    @Test func theStepperBindingClampsIntoTheRange() {
        #expect(SettingsScreen.stepperValue(offset: -9, system: .small) == -1)
        #expect(SettingsScreen.stepperValue(offset: 2, system: .large) == 2)
    }
}

@Suite struct SettingsTextTests {
    @Test func namesInstrumentsInVocabularyOrderOrNotSet() {
        #expect(SettingsModel.summary(["violin", "five_string_banjo"]) == "Violin, 5-string banjo")
        #expect(SettingsModel.summary(["retired_banjo"]) == "Not set")
        #expect(SettingsModel.summary([]) == "Not set")
    }

    @Test func countsSearchedServicesOrNone() {
        #expect(SettingsModel.searchProvidersSummary(["youtube", "tidal"]) == "2 of 8")
        #expect(SettingsModel.searchProvidersSummary(["tidal", "mixcloud"]) == "1 of 8")
        #expect(SettingsModel.searchProvidersSummary(["mixcloud"]) == SettingsModel.noServices)
        #expect(SettingsModel.searchProvidersSummary([]) == "No services selected")
    }

    @Test func namesEachQualityWithTheRateItRecordsAt() {
        let mono = Vocabulary.audioQualities.map { SettingsModel.qualityLabel($0, channels: .mono) }
        #expect(mono == ["Low, 48 kbps", "Standard, 64 kbps", "High, 128 kbps", "Highest, 160 kbps"])
        let stereo = Vocabulary.audioQualities.map { SettingsModel.qualityLabel($0, channels: .stereo) }
        #expect(stereo == ["Low, 96 kbps", "Standard, 128 kbps", "High, 256 kbps", "Highest, 320 kbps"])
    }

    @Test func namesTheRejectedChangesInTheSingularAndPlural() {
        #expect(SettingsModel.rejectedMessage(count: 0) == nil)
        #expect(SettingsModel.rejectedMessage(count: 1) == SettingsModel.oneRejected)
        #expect(
            SettingsModel.rejectedMessage(count: 3)
                == "3 changes were rejected by the server and are only on this device.")
    }

    @Test func readsStorageAsUsedOfQuotaAndCapsTheBar() {
        let figures = StorageFigures(usedBytes: 48_200_000, quotaBytes: 1_000_000_000, maxFileBytes: 1)
        #expect(RecordingText.storageUsed(figures) == "48.2 MB of 1 GB used")
        #expect(SettingsModel.storageFraction(figures) == 0.0482)
        let over = StorageFigures(usedBytes: 2_000, quotaBytes: 1_000, maxFileBytes: 1)
        #expect(SettingsModel.storageFraction(over) == 1)
    }

    @Test func namesTheAudioOnThisDevice() {
        #expect(SettingsModel.localAudioText(0) == "0 B of audio on this device")
        #expect(SettingsModel.localAudioText(12_400_000) == "12.4 MB of audio on this device")
    }

    @Test func namesTheAppAndItsVersionUnderAbout() {
        #expect(SettingsScreen.aboutLine(version: "0.7.0") == "Crosstune 0.7.0")
        #expect(SettingsScreen.about == "About")
    }

    @Test func saysHowLongAgoTheLastSyncFinished() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let locale = Locale(identifier: "en_US")
        #expect(SettingsModel.lastSyncedText(now.addingTimeInterval(-20), now: now, locale: locale) == "Just now")
        #expect(
            SettingsModel.lastSyncedText(now.addingTimeInterval(-300), now: now, locale: locale) == "5 minutes ago")
        #expect(
            SettingsModel.lastSyncedText(now.addingTimeInterval(-86_400), now: now, locale: locale) == "yesterday")
    }
}

@MainActor
@Suite struct SettingsModelTests {
    @Test func readsTheMusiciansInstrumentsAndQuality() async throws {
        let store = try await SampleCatalog.makeStore()
        let model = try await loadedModel(store)
        #expect(model.instrumentSummary == "Violin, 5-string banjo")
        #expect(model.searchProvidersSummary == "5 of 8")
        #expect(model.plays("violin"))
        #expect(!model.plays("guitar"))
        #expect(model.audioQuality == "standard")
        #expect(!model.keepsOffline)
        #expect(model.rejectedMessage == nil)
        #expect(model.storage == SampleCatalog.storage)
    }

    @Test func readsDefaultsWithNoSettingsRow() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        #expect(model.instrumentSummary == "Not set")
        #expect(model.audioQuality == "standard")
        #expect(model.storage == nil)
    }

    @Test func hidesStorageUntilTheServerHasNamedAQuota() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 10, quotaBytes: 0, maxFileBytes: 0))
        let model = try await loadedModel(store)
        #expect(model.storage == nil)
    }

    @Test func togglesAnInstrumentAtOnceAndStoresIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        model.setPlays("mandolin", true)
        // Shown before the write lands, so the toggle never springs back.
        #expect(model.plays("mandolin"))
        model.setPlays("violin", true)
        try await eventually { try await storedSettings(store)?.instruments == ["violin", "mandolin"] }
        try await eventually { model.instrumentSummary == "Violin, Mandolin" }
        #expect(try await store.pendingChangeCount() == 1)

        model.setPlays("mandolin", false)
        #expect(!model.plays("mandolin"))
        try await eventually { try await storedSettings(store)?.instruments == ["violin"] }
        #expect(model.instrumentsFailure == nil)
    }

    /// Writes run in order, so once a later toggle of another instrument is stored, every toggle
    /// before it has settled.
    @Test func showsAnInstrumentFailureOnlyForTheLatestToggleOfThatInstrument() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        try await store.write { writer in
            for event in ["INSERT", "UPDATE"] {
                try writer.db.execute(
                    sql: """
                        CREATE TRIGGER refuse_violin_\(event.lowercased()) BEFORE \(event) ON user_settings
                        WHEN NEW.instruments LIKE '%"violin"%' BEGIN SELECT RAISE(ABORT, 'refused'); END
                        """)
            }
        }

        model.setPlays("violin", true)
        model.setPlays("violin", false)
        model.setPlays("mandolin", true)
        try await eventually { try await storedSettings(store)?.instruments == ["mandolin"] }
        #expect(model.instrumentsFailure == nil)

        model.setPlays("violin", true)
        model.setPlays("guitar", true)
        try await eventually { try await storedSettings(store)?.instruments == ["guitar", "mandolin"] }
        #expect(model.instrumentsFailure != nil)
        #expect(!model.plays("violin"))
    }

    @Test func followsAnInstrumentChangedElsewhere() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        model.setPlays("guitar", true)
        try await eventually { try await storedSettings(store)?.instruments == ["guitar"] }
        try await Commands(store: store).toggleInstrumentSetting(
            clerkUserID: store.userID, instrument: "guitar", on: false)
        try await eventually { !model.plays("guitar") }
    }

    @Test func storesAChosenQuality() async throws {
        let store = try await SampleCatalog.makeStore()
        let model = try await loadedModel(store)
        model.setAudioQuality("high")
        #expect(model.audioQuality == "high")
        try await eventually { try await storedSettings(store)?.audioQuality == "high" }
        model.setAudioQuality("low")
        try await eventually { try await storedSettings(store)?.audioQuality == "low" }
        #expect(model.audioQuality == "low")
    }

    @Test func storesAChosenPlayFirst() async throws {
        let store = try await SampleCatalog.makeStore()
        let model = try await loadedModel(store)
        #expect(model.playFirst == UserSettings.defaultPlayFirst)
        model.setPlayFirst(UserSettings.playFirstAppleMusic)
        #expect(model.playFirst == UserSettings.playFirstAppleMusic)
        try await eventually { try await storedSettings(store)?.playFirst == UserSettings.playFirstAppleMusic }
        model.setPlayFirst(UserSettings.playFirstRecordings)
        try await eventually { try await storedSettings(store)?.playFirst == UserSettings.playFirstRecordings }
        #expect(model.playFirst == UserSettings.playFirstRecordings)
    }

    @Test func storesTheStatusANewTuneStartsWith() async throws {
        let store = try await SampleCatalog.makeStore()
        let model = try await loadedModel(store)
        #expect(model.newTuneStatus == "want_to_learn")
        model.setNewTuneStatus("known")
        #expect(model.newTuneStatus == "known")
        try await eventually { try await storedSettings(store)?.newTuneStatus == "known" }
    }

    @Test func storesTheGenreANewTuneStartsWithAndSumsItUp() async throws {
        let store = try await SampleCatalog.makeStore()
        let model = try await loadedModel(store)
        #expect(model.newTuneGenre == "")
        #expect(model.newTunesSummary == TuneFieldLabels.notSet)
        model.setNewTuneGenre("Irish")
        #expect(model.newTuneGenre == "Irish")
        #expect(model.newTunesSummary == "Irish")
        try await eventually { try await storedSettings(store)?.newTuneGenre == "Irish" }
        model.setNewTuneGenre("")
        try await eventually { try await storedSettings(store)?.newTuneGenre == nil }
        #expect(model.newTunesSummary == TuneFieldLabels.notSet)
    }

    @Test func showsNoFailureForAGenreALaterKeystrokeSaved() async throws {
        let store = try await SampleCatalog.makeStore()
        let model = try await loadedModel(store)
        try await store.write { writer in
            for event in ["INSERT", "UPDATE"] {
                try writer.db.execute(
                    sql: """
                        CREATE TRIGGER refuse_genre_\(event.lowercased()) BEFORE \(event) ON user_settings
                        WHEN NEW.new_tune_genre = 'R' BEGIN SELECT RAISE(ABORT, 'refused'); END
                        """)
            }
        }

        model.setNewTuneGenre("R")
        model.setNewTuneGenre("Re")

        // Writes run in order, so the refused one has settled once the later one is stored.
        try await eventually { try await storedSettings(store)?.newTuneGenre == "Re" }
        #expect(model.newTuneGenreFailure == nil)
    }

    @Test func namesEachPlayFirstChoice() {
        for choice in Vocabulary.playFirsts { #expect(PlayFirstText.names[choice] != nil) }
        #expect(Set(Vocabulary.playFirsts) == [UserSettings.playFirstRecordings, UserSettings.playFirstAppleMusic])
    }

    @Test func downloadsEverythingAndStartsATransferWhenTurnedOn() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let counter = TransferCounter()
        let engine = SyncEngine(
            store: store, api: SilentSyncAPI(), isOffline: { false }, batchSize: 10,
            sleep: { _ in }, transferPass: { counter.count += 1 })
        let model = try await loadedModel(store, engine: engine)

        model.setKeepsOffline(true)
        #expect(model.keepsOffline)
        try await eventually { try await store.meta(.keepOffline, as: Bool.self) == true }
        try await eventually { counter.count == 1 }

        model.setKeepsOffline(false)
        try await eventually { try await store.meta(.keepOffline, as: Bool.self) == false }
        #expect(!model.keepsOffline)
        try await Task.sleep(for: .milliseconds(50))
        #expect(counter.count == 1)
    }

    @Test func namesTheChangesTheServerRefused() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        try await store.setMeta(.invalidChanges, to: 2)
        try await eventually {
            model.rejectedMessage == "2 changes were rejected by the server and are only on this device."
        }
    }

    @Test func syncsOnRequest() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let engine = SyncEngine(store: store, api: SilentSyncAPI(), isOffline: { false }, sleep: { _ in })
        let model = try await loadedModel(store, engine: engine)
        #expect(engine.lastSyncedAt == nil)
        await model.syncNow()
        #expect(!model.isSyncing)
        #expect(engine.lastSyncedAt != nil)
    }

    @Test func reportsARefusedWriteAndShowsTheStoredValueAgain() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        try store.close()
        model.setPlays("guitar", true)
        try await eventually { model.instrumentsFailure != nil }
        #expect(!model.plays("guitar"))
        model.clearInstrumentsFailure()
        #expect(model.instrumentsFailure == nil)
    }

    @Test func removesDownloadedAudioAndShowsWhatIsLeft() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        for (id, state, local, bytes) in [
            ("d1", "ready", LocalFileState.downloaded, 1_000), ("w1", "pending_upload", .captured, 200),
        ] {
            try Data(repeating: 0, count: bytes).write(to: store.audioFolder.appending(path: "\(id).m4a"))
            try await store.write { writer in
                try Recording(id: id, tuneID: nil, source: "microphone", addedAt: noon, state: state)
                    .insert(writer.db)
                try RecordingFile(id: id, localState: local, fileName: "\(id).m4a", bytes: Int64(bytes))
                    .insert(writer.db)
            }
        }
        let model = try await loadedModel(store)
        try await eventually { model.localAudioBytes == 1_200 }

        model.removeDownloads()

        #expect(model.isRemovingDownloads)
        try await eventually { model.localAudioBytes == 200 }
        try await eventually { !model.isRemovingDownloads }
        #expect(model.removeDownloadsFailure == nil)
    }

    @Test func searchesEveryServiceWithNoSettingsRow() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        #expect(
            model.searchProvidersSummary
                == "8 of 8")
        #expect(searchableProviders.allSatisfy(model.searches))
    }

    @Test func searchesEveryServiceForADeletedSettingsRow() async throws {
        let store = try await SampleCatalog.makeStore()
        var settings = SampleCatalog.settings
        settings.searchProviders = ["tidal"]
        settings.deletedAt = .now
        let row = settings
        try await store.write { writer in try writer.put(row, at: .now) }
        let model = try await loadedModel(store)
        try await eventually { searchableProviders.allSatisfy(model.searches) }
        #expect(
            model.searchProvidersSummary
                == "8 of 8")
    }

    @Test func togglesAServiceAtOnceAndStoresIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        model.setSearches("spotify", false)
        // Shown before the write lands, so the toggle never springs back.
        #expect(!model.searches("spotify"))
        let rest = searchableProviders.filter { $0 != "spotify" }
        try await eventually { try await storedSettings(store)?.searchProviders == rest }
        #expect(try await store.pendingChangeCount() == 1)

        for provider in rest { model.setSearches(provider, false) }
        try await eventually { try await storedSettings(store)?.searchProviders == [] }
        try await eventually { model.searchProvidersSummary == SettingsModel.noServices }
        #expect(model.searchProvidersFailure == nil)
    }

    @Test func followsAServiceChangedElsewhere() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        model.setSearches("tidal", false)
        try await eventually { try await storedSettings(store)?.searchProviders.contains("tidal") == false }
        try await Commands(store: store).toggleSearchProvider(
            clerkUserID: store.userID, provider: "tidal", on: true)
        try await eventually { model.searches("tidal") }
    }

    @Test func reportsARefusedServiceToggleAndShowsTheStoredValueAgain() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        try store.close()
        model.setSearches("youtube", false)
        try await eventually { model.searchProvidersFailure != nil }
        #expect(model.searches("youtube"))
        model.clearSearchProvidersFailure()
        #expect(model.searchProvidersFailure == nil)
    }

    @Test func reportsARefusedRemoval() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = try await loadedModel(store)
        try store.close()

        model.removeDownloads()

        try await eventually { model.removeDownloadsFailure != nil }
        #expect(!model.isRemovingDownloads)
    }
}

@Suite struct AppleMusicRowTests {
    @Test(
        arguments: [
            (AppleMusicAccessState.notAsked, "Previews", AppleMusicRowAction.request),
            (.fullTracks, "Full tracks", .none),
            (.noSubscription, "Previews", .none),
            (.declined, "Previews", .openSystemSettings),
        ] as [(AppleMusicAccessState, String, AppleMusicRowAction)]
    )
    func showsTheValueAndTapForEachState(state: AppleMusicAccessState, value: String, action: AppleMusicRowAction) {
        #expect(AppleMusicText.value(state) == value)
        #expect(AppleMusicRowAction.make(state) == action)
    }

    @Test func hintsWhatATapDoes() {
        #expect(AppleMusicRowAction.request.hint == AppleMusicText.askHint)
        #expect(AppleMusicRowAction.openSystemSettings.hint == AppleMusicText.settingsHint)
        #expect(AppleMusicRowAction.none.hint == nil)
    }
}

@Suite struct SettingsRootTests {
    @Test func everySettingsSectionHasOneHomeOnPhone() {
        // The two cards, then what each category's page declares.
        var homes: [SettingsScreen.Sections] = SettingsCategory.allCases.flatMap { [$0.sections, $0.pageRows] }
        homes += [[.account], [.stats]]
        var seen: SettingsScreen.Sections = []
        for home in homes {
            #expect(seen.isDisjoint(with: home), "\(home) repeats a section")
            seen.formUnion(home)
        }
        #expect(seen == .all)
    }

    @Test func syncLineSaysWhatNeedsAttentionFirst() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let en = Locale(identifier: "en_US")
        #expect(
            SettingsRoot.syncLine(attention: .offline, lastSynced: now, now: now, locale: en)
                == SyncStatus.offline.label)
        #expect(
            SettingsRoot.syncLine(attention: nil, lastSynced: now.addingTimeInterval(-120), now: now, locale: en)
                == "Synced 2 minutes ago")
        #expect(
            SettingsRoot.syncLine(attention: nil, lastSynced: now.addingTimeInterval(-10), now: now, locale: en)
                == "Synced just now")
        #expect(SettingsRoot.syncLine(attention: nil, lastSynced: nil, now: now, locale: en) == "Not synced yet")
    }

    @Test @MainActor func statusBarLabelsEveryStatusAndHidesEmptyOnes() {
        let counts = ["known": 4, "learning": 0, "want_to_learn": 9]
        #expect(StatusBar.accessibilityText(counts) == "Known 4, Learning 0, Unknown 9")
        #expect(StatusBar.segments(counts).map(\.status) == ["known", "want_to_learn"])
    }

    /// The Settings stats card and the stats screen draw the bar from the one count, so the
    /// card's line and its bar always agree on archived tunes.
    @Test func statusBarCountsComeFromTheStats() {
        let counts = Stats.Counts(
            known: 4, learning: 2, wantToLearn: 9, tunes: 15, archived: 3, lists: 0, recordings: 0, links: 0,
            scans: 0, scanTunes: 0)
        #expect(StatusBar.byStatus(counts) == ["known": 4, "learning": 2, "want_to_learn": 9])
    }

    @Test func categoriesNameTheirPages() {
        #expect(
            SettingsCategory.allCases.map(\.title) == [
                "Instruments", "New tunes", "Music services", "Recording", Appearance.title, "Sync and storage",
                "Import and export", SettingsScreen.about,
            ])
    }

    @Test func importAndExportFollowsSyncAndStorage() throws {
        let categories = SettingsCategory.allCases
        let index = try #require(categories.firstIndex(of: .importExport))
        #expect(categories[index - 1] == .syncAndStorage)
        #expect(SettingsCategory.importExport.title == "Import and export")
        #expect(SettingsCategory.importExport.systemImage == "arrow.up.arrow.down")
        #expect(SettingsCategory.importExport.sections == [.importExport])
    }

    /// The usage data toggle lives in the About group, so a page the root opens must show it.
    @Test func aRowOnTheRootOpensTheUsageDataToggle() {
        let pages = SettingsCategory.allCases.filter { $0.sections.contains(.about) }
        #expect(pages.count == 1)
    }
}

#if os(macOS)
    @Suite struct MacSettingsTabsTests {
        @Test func everySectionShowsInExactlyOneTab() {
            var seen: SettingsScreen.Sections = []
            for pane in MacSettingsTabs.Pane.allCases {
                #expect(seen.isDisjoint(with: pane.sections), "\(pane) repeats a section")
                seen.formUnion(pane.sections)
            }
            #expect(seen == .all)
        }

        @Test func importAndExportIsTheLastTab() {
            #expect(MacSettingsTabs.Pane.allCases.last == .importExport)
            #expect(MacSettingsTabs.Pane.importExport.title == "Import and export")
            #expect(MacSettingsTabs.Pane.importExport.systemImage == "arrow.up.arrow.down")
            #expect(MacSettingsTabs.Pane.importExport.sections == [.importExport])
            #expect(MacSettingsTabs.Pane(rawValue: "import-export") == .importExport)
        }

        @Test func macGeneralTabIsUnchanged() {
            #expect(
                MacSettingsTabs.Pane.general.sections == [.appearance, .recording, .downloads, .sync, .storage, .about])
        }
    }
#endif

@Suite struct ImportExportSectionsTests {
    /// The same words as the web's Import and export page.
    @Test func copyMatchesTheWeb() {
        #expect(ImportExportSections.title == "Import and export")
        #expect(ImportExportSections.importHeader == "Import")
        #expect(
            ImportExportSections.importHelp
                == "Add many tunes at once. You will get a chance to review before Crosstune adds them.")
        #expect(ImportExportSections.moreInfo == "More info")
        #expect(ImportExportSections.exportHeader == "Export")
        #expect(
            ImportExportSections.exportHelp
                == "Save your tunes, recordings, and scans to your device in a single zip file.")
        #expect(ImportCopy.title == "Import tunes")
        #expect(ExportDataSheet.title == "Export data")
    }

    @Test func importSheetPointsRecordingsToTheRecordingsScreen() {
        #expect(
            ImportCopy.recordingsNote
                == "This imports tune titles. To bring in recordings, upload them on the Recordings screen. "
                + "You can choose many files at once.")
    }

    @Test func moreInfoLinksToTheImportHelpPage() throws {
        let text = ImportExportSections.importHelpText
        #expect(String(text.characters) == "\(ImportExportSections.importHelp) \(ImportExportSections.moreInfo)")
        let linked = text.runs.filter { $0.link != nil }
        #expect(linked.count == 1)
        let run = try #require(linked.first)
        #expect(String(text[run.range].characters) == ImportExportSections.moreInfo)
        #expect(run.link == URL(string: "https://crosstune.app/help/import"))
    }

    /// Import and export live on their own page, so the account offers neither.
    @Test func accountOffersNeitherImportNorExport() throws {
        let text = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.sources.appending(path: "Account/AccountSections.swift")))
        for name in ["ImportSheet", "ImportCopy", "ExportDataSheet"] {
            #expect(!text.contains(name), "AccountSections names \(name)")
        }
    }
}
