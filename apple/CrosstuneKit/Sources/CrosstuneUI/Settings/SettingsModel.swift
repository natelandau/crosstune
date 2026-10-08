import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import Foundation
import GRDB
import Observation

/// What the settings screen reads from the store in one go.
struct StoredSettings: Equatable, Sendable {
    /// Every instrument the settings row holds, known to this build or not.
    var instruments: Set<String>
    /// Every service the settings row searches, known to this build or not.
    var searchProviders: Set<String>
    var audioQuality: String
    var playFirst: String
    var keepsOffline: Bool
    var invalidChanges: Int
    var storage: StorageFigures?
    /// The audio this device holds, captured or downloaded.
    var localAudioBytes: Int64

    static func fetch(_ db: Database, settingsRow: String) throws -> StoredSettings {
        let row = try UserSettings.fetchOne(db, key: settingsRow).flatMap { $0.deletedAt == nil ? $0 : nil }
        let quality = row.map(\.audioQuality).flatMap { Vocabulary.audioQualities.contains($0) ? $0 : nil }
        return StoredSettings(
            instruments: Set(row?.instruments ?? []),
            searchProviders: Set(row?.searchProviders ?? searchableProviders),
            audioQuality: quality ?? SettingsModel.defaultQuality,
            playFirst: storedPlayFirst(row),
            // Anything but a stored true reads as off, as the web reads it.
            keepsOffline: (try? MetaKey.keepOffline.value(in: db, as: Bool.self)) == true,
            invalidChanges: (try? MetaKey.invalidChanges.value(in: db, as: Int.self)) ?? 0,
            storage: try? MetaKey.storage.value(in: db, as: StorageFigures.self),
            localAudioBytes: try RecordingFile.localAudioBytes(db))
    }
}

/// The settings screen's state: the musician's instruments and recording quality, this
/// device's download choice, and what sync has refused and stored. Every setting saves as it
/// changes, and shows its new value at once rather than when the store catches up.
@MainActor
@Observable
public final class SettingsModel {
    nonisolated public static let instruments = "Instruments"
    /// The footer under the instruments setting, wherever it is asked.
    nonisolated public static let instrumentsHelp = "Tunes show a tuning for each instrument chosen here."
    nonisolated public static let musicServices = "Music services"
    /// The footer under the music services setting, wherever it is asked.
    nonisolated public static let musicServicesHelp =
        "Select which music services are included when searching for recordings of tunes."
    nonisolated public static let noServices = "No services selected"
    nonisolated public static let recording = "Recording"
    nonisolated public static let quality = "Quality"
    nonisolated public static let qualityFooter = "Higher quality makes larger files."
    nonisolated public static let channelsTitle = "Channels"
    nonisolated public static let channelsFooter =
        "Stereo needs a stereo microphone or interface, and makes files twice the size."
    nonisolated public static let keepOffline = "Download all recordings to this device"
    nonisolated public static let keepOfflineFooter =
        "Your recordings are always saved to your account and show up on every device you sign in on. A recording is kept on this device once you play it here. Turn this on to download every recording ahead of time, so all of them play even with no signal."
    nonisolated public static let removeDownloads = "Remove downloaded audio"
    nonisolated public static let removeDownloadsFooter =
        "Frees up space on this device. Your recordings stay in your account and download again when you play them. Anything not yet saved to your account is kept."
    #if os(macOS)
        nonisolated public static let appearanceFooter =
            "This applies to this device only. System follows the device when it switches."
    #else
        nonisolated public static let appearanceFooter =
            "These apply to this device only. System follows the device when it switches."
    #endif
    nonisolated public static let sync = "Sync"
    nonisolated public static let status = "Status"
    nonisolated public static let recordings = "Recordings"
    nonisolated public static let lastSynced = "Last synced"
    nonisolated public static let justNow = "Just now"
    nonisolated static let justNowInSentence = "just now"
    nonisolated public static let syncNow = "Sync now"
    nonisolated public static let oneRejected = "1 change was rejected by the server and is only on this device."
    nonisolated public static let storage = "Storage"
    nonisolated public static let storageUsed = "Storage used"
    /// The quality a musician with no settings row, or an unknown value, records at.
    nonisolated static let defaultQuality = "standard"

    /// Why the last instrument toggle failed, cleared by the next one or by opening the sheet.
    public private(set) var instrumentsFailure: String?
    /// Why the last service toggle failed, cleared by the next one or by opening the sheet.
    public private(set) var searchProvidersFailure: String?
    /// Why the last quality choice failed, cleared by the next one.
    public private(set) var qualityFailure: String?
    public private(set) var playFirstFailure: String?
    /// Why the last download choice failed, cleared by the next one.
    public private(set) var keepOfflineFailure: String?
    /// Why the last removal of downloaded audio failed, cleared by the next one.
    public private(set) var removeDownloadsFailure: String?
    /// Whether a removal of downloaded audio is still running.
    public private(set) var isRemovingDownloads = false
    /// Whether a sync started here is still running.
    public private(set) var isSyncing = false

    private let store: CrosstuneStore
    private let engine: SyncEngine?
    private let analytics: AnalyticsClient
    private let stored: LiveQuery<StoredSettings?>
    private var pendingInstruments: [String: PendingWrite<Bool>] = [:]
    private var pendingSearchProviders: [String: PendingWrite<Bool>] = [:]
    private var pendingQuality = PendingWrite<String>()
    private var pendingPlayFirst = PendingWrite<String>()
    private var pendingKeepOffline = PendingWrite<Bool>()
    @ObservationIgnored private var lastWrite: Task<Void, Never>?
    @ObservationIgnored private var following: Task<Void, Never>?

    /// - Parameter engine: Runs a sync on request and fetches recordings once downloads are
    ///   on. Nil where there is no account, as in the sample shell.
    public init(store: CrosstuneStore, engine: SyncEngine?, analytics: AnalyticsClient = .noop) {
        self.store = store
        self.engine = engine
        self.analytics = analytics
        let settingsRow = settingsID(clerkUserID: store.userID)
        stored = LiveQuery(store, initial: nil) { db in try StoredSettings.fetch(db, settingsRow: settingsRow) }
        let stored = stored
        following = Task { [weak self] in
            for await _ in Observations({ @MainActor in stored.value }) {
                self?.storeChanged()
            }
        }
    }

    isolated deinit {
        following?.cancel()
    }

    /// Whether the store has been read. The account's settings stay hidden until it has, so a
    /// musician never sees their choices flash from empty to set.
    public var isLoaded: Bool { stored.value != nil }

    // MARK: Instruments

    public func plays(_ instrument: String) -> Bool {
        pendingInstruments[instrument]?.value ?? stored.value?.instruments.contains(instrument) ?? false
    }

    /// The instruments played, by label in vocabulary order, or "Not set".
    public var instrumentSummary: String {
        Self.summary(Vocabulary.instruments.filter(plays))
    }

    nonisolated static func summary(_ instruments: [String]) -> String {
        let labels = instruments.compactMap { Vocabulary.instrumentLabels[$0] }
        return labels.isEmpty ? TuneFieldLabels.notSet : labels.joined(separator: ", ")
    }

    /// Turns one instrument on or off. Each toggle writes only itself, so two in a row both land.
    public func setPlays(_ instrument: String, _ on: Bool) {
        instrumentsFailure = nil
        let token = pendingInstruments[instrument, default: PendingWrite()].begin(on)
        let store = store
        let chosen = Vocabulary.instruments.filter(plays)
        enqueue {
            try await Commands(store: store).toggleInstrumentSetting(
                clerkUserID: store.userID, instrument: instrument, on: on)
        } settled: { model, error in
            if let error {
                model.pendingInstruments[instrument]?.fail(token)
                model.instrumentsFailure = failureMessage(error)
            } else {
                model.pendingInstruments[instrument]?.land(
                    token, stored: model.stored.value?.instruments.contains(instrument))
                model.analytics.send(.settingChanged(.instruments(chosen)))
            }
        }
    }

    /// Forgets a refusal from the last visit to the instruments sheet.
    public func clearInstrumentsFailure() {
        instrumentsFailure = nil
    }

    // MARK: Music services

    public func searches(_ provider: String) -> Bool {
        pendingSearchProviders[provider]?.value ?? stored.value?.searchProviders.contains(provider) ?? false
    }

    /// How many of the searchable services are on, as "2 of 8", or "No services selected".
    public var searchProvidersSummary: String {
        Self.searchProvidersSummary(searchableProviders.filter(searches))
    }

    nonisolated static func searchProvidersSummary(_ providers: [String]) -> String {
        let count = searchableProviders.filter(providers.contains).count
        return count == 0 ? noServices : "\(count) of \(searchableProviders.count)"
    }

    /// Turns one service on or off. Each toggle writes only itself, so two in a row both land.
    public func setSearches(_ provider: String, _ on: Bool) {
        searchProvidersFailure = nil
        let token = pendingSearchProviders[provider, default: PendingWrite()].begin(on)
        let store = store
        let chosen = searchableProviders.filter(searches).map(LinkService.init(provider:))
        enqueue {
            try await Commands(store: store).toggleSearchProvider(
                clerkUserID: store.userID, provider: provider, on: on)
        } settled: { model, error in
            if let error {
                model.pendingSearchProviders[provider]?.fail(token)
                model.searchProvidersFailure = failureMessage(error)
            } else {
                model.pendingSearchProviders[provider]?.land(
                    token, stored: model.stored.value?.searchProviders.contains(provider))
                model.analytics.send(.settingChanged(.searchProviders(chosen)))
            }
        }
    }

    /// Forgets a refusal from the last visit to the music services sheet.
    public func clearSearchProvidersFailure() {
        searchProvidersFailure = nil
    }

    // MARK: Playing

    /// Which version a list plays when a tune has both: `recordings` or `apple_music`.
    public var playFirst: String {
        pendingPlayFirst.value ?? stored.value?.playFirst ?? UserSettings.defaultPlayFirst
    }

    public func setPlayFirst(_ choice: String) {
        playFirstFailure = nil
        let changed = choice != playFirst
        let token = pendingPlayFirst.begin(choice)
        let store = store
        enqueue {
            try await Commands(store: store).setPlayFirst(clerkUserID: store.userID, playFirst: choice)
        } settled: { model, error in
            if let error {
                model.pendingPlayFirst.fail(token)
                model.playFirstFailure = failureMessage(error)
            } else {
                model.pendingPlayFirst.land(token, stored: model.stored.value?.playFirst)
                if changed, let choice = PlayFirst(choice) { model.analytics.send(.settingChanged(.playFirst(choice))) }
            }
        }
    }

    // MARK: Recording

    /// The quality recordings are made at: `low`, `standard`, or `high`.
    public var audioQuality: String {
        pendingQuality.value ?? stored.value?.audioQuality ?? Self.defaultQuality
    }

    public func setAudioQuality(_ quality: String) {
        qualityFailure = nil
        let changed = quality != audioQuality
        let token = pendingQuality.begin(quality)
        let store = store
        enqueue {
            try await Commands(store: store).setAudioQuality(clerkUserID: store.userID, quality: quality)
        } settled: { model, error in
            if let error {
                model.pendingQuality.fail(token)
                model.qualityFailure = failureMessage(error)
            } else {
                model.pendingQuality.land(token, stored: model.stored.value?.audioQuality)
                if changed, let quality = AudioQuality(quality) {
                    model.analytics.send(.settingChanged(.audioQuality(quality)))
                }
            }
        }
    }

    /// A quality's name and the rate it records at, as `Standard, 64 kbps`. The rate is read from
    /// the preset itself, so changing one changes what the picker says.
    nonisolated public static func qualityLabel(_ quality: String, channels: CaptureChannels) -> String {
        let name = Vocabulary.audioQualityNames[quality] ?? quality
        guard let mono = Vocabulary.audioBitrates[quality] else { return name }
        let bitrate = CaptureChannels.bitrate(mono: mono, channels: channels.count)
        return "\(name), \(bitrate / 1000) kbps"
    }

    /// A channel choice's name in the picker.
    nonisolated public static func channelLabel(_ channels: CaptureChannels) -> String {
        switch channels {
        case .mono: "Mono"
        case .stereo: "Stereo"
        }
    }

    /// Whether this device downloads every recording ahead of time.
    public var keepsOffline: Bool {
        pendingKeepOffline.value ?? stored.value?.keepsOffline ?? false
    }

    /// Stores the download choice for this device. Turning it on starts fetching at once.
    public func setKeepsOffline(_ on: Bool) {
        keepOfflineFailure = nil
        let changed = on != keepsOffline
        let token = pendingKeepOffline.begin(on)
        let store = store
        enqueue {
            try await store.setMeta(.keepOffline, to: on)
        } settled: { model, error in
            if let error {
                model.pendingKeepOffline.fail(token)
                model.keepOfflineFailure = failureMessage(error)
                return
            }
            model.pendingKeepOffline.land(token, stored: model.stored.value?.keepsOffline)
            if changed { model.analytics.send(.settingChanged(.downloadAll(on))) }
            if on, let engine = model.engine {
                Task { await engine.transfer() }
            }
        }
    }

    /// How much audio this device holds, captured or downloaded.
    public var localAudioBytes: Int64 {
        stored.value?.localAudioBytes ?? 0
    }

    /// The audio on this device as `12.4 MB of audio on this device`.
    nonisolated public static func localAudioText(_ bytes: Int64) -> String {
        "\(RecordingText.bytes(bytes)) of audio on this device"
    }

    /// Deletes the downloaded audio of every ready recording. A recording not yet on the server
    /// keeps its audio.
    public func removeDownloads() {
        guard !isRemovingDownloads else { return }
        removeDownloadsFailure = nil
        isRemovingDownloads = true
        let store = store
        enqueue {
            try await Commands(store: store).clearDownloadedAudio()
        } settled: { model, error in
            model.isRemovingDownloads = false
            if let error { model.removeDownloadsFailure = failureMessage(error) }
        }
    }

    // MARK: Sync and storage

    /// What the server refused, or nil when it has refused nothing.
    public var rejectedMessage: String? {
        Self.rejectedMessage(count: stored.value?.invalidChanges ?? 0)
    }

    nonisolated static func rejectedMessage(count: Int) -> String? {
        switch count {
        case ..<1: nil
        case 1: oneRejected
        default: "\(count) changes were rejected by the server and are only on this device."
        }
    }

    /// Runs a sync now, or once more after the one in flight.
    public func syncNow() async {
        guard let engine, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        await engine.sync()
    }

    /// How long ago the last sync finished, in words.
    nonisolated public static func lastSyncedText(
        _ date: Date, now: Date, locale: Locale = .current, inSentence: Bool = false
    ) -> String {
        if now.timeIntervalSince(date) < 60 { return inSentence ? justNowInSentence : justNow }
        let formatter = RelativeDateTimeFormatter()
        if inSentence { formatter.formattingContext = .middleOfSentence }
        formatter.locale = locale
        formatter.dateTimeStyle = .named
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: now)
    }

    /// The account's storage figures, once the server has said what its quota is.
    public var storage: StorageFigures? {
        guard let figures = stored.value?.storage, figures.quotaBytes > 0 else { return nil }
        return figures
    }

    /// The share of the quota spent, from 0 to 1.
    nonisolated public static func storageFraction(_ figures: StorageFigures) -> Double {
        guard figures.quotaBytes > 0 else { return 0 }
        return min(1, max(0, Double(figures.usedBytes) / Double(figures.quotaBytes)))
    }

    // MARK: Writes

    /// Runs writes one after another, so two quick choices land in the order they were made.
    private func enqueue(
        _ write: @escaping @Sendable () async throws -> Void,
        settled: @escaping @MainActor (SettingsModel, (any Error)?) -> Void
    ) {
        let previous = lastWrite
        lastWrite = Task { [weak self] in
            await previous?.value
            var failure: (any Error)?
            do {
                try await write()
            } catch {
                failure = error
            }
            guard let self else { return }
            settled(self, failure)
        }
    }

    private func storeChanged() {
        for instrument in pendingInstruments.keys {
            pendingInstruments[instrument]?.storeChanged()
        }
        for provider in pendingSearchProviders.keys {
            pendingSearchProviders[provider]?.storeChanged()
        }
        pendingQuality.storeChanged()
        pendingPlayFirst.storeChanged()
        pendingKeepOffline.storeChanged()
    }
}
