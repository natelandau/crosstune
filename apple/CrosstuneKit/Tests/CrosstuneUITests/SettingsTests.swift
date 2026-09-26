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
    func storage() async throws -> StorageFigures { StorageFigures(usedBytes: 0, quotaBytes: 0, maxFileBytes: 0) }
    func resolveLink(url: String) async throws -> ResolvedLink { throw URLError(.badURL) }
    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
        throw URLError(.badURL)
    }
    func uploadFinished(recordingID: String) async throws { throw URLError(.badURL) }
    func downloadURL(recordingID: String) async throws -> URL { throw URLError(.badURL) }
    func retryRecording(recordingID: String) async throws { throw URLError(.badURL) }
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
        pending.fail(token)
        #expect(pending.value == nil)
    }

    @Test func neverLetsAnEarlierWriteSettleALaterOne() {
        var pending = PendingWrite<Bool>()
        let first = pending.begin(true)
        _ = pending.begin(false)
        pending.fail(first)
        #expect(pending.value == false)
        pending.land(first, stored: false)
        #expect(pending.value == false)
    }
}

@Suite struct SettingsTextTests {
    @Test func namesInstrumentsInVocabularyOrderOrNotSet() {
        #expect(SettingsModel.summary(["violin", "five_string_banjo"]) == "Violin, 5-string banjo")
        #expect(SettingsModel.summary(["retired_banjo"]) == "Not set")
        #expect(SettingsModel.summary([]) == "Not set")
    }

    @Test func namesEachQualityWithTheRateItRecordsAt() {
        #expect(
            Vocabulary.audioQualities.map(SettingsModel.qualityLabel) == [
                "Low, 48 kbps", "Standard, 64 kbps", "High, 128 kbps",
            ])
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
        #expect(SettingsModel.storageText(figures) == "48.2 MB of 1 GB used")
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
                try Recording(id: id, tuneID: nil, source: "microphone", recordedAt: noon, state: state)
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
