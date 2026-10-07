import CrosstuneAudio
import CrosstuneAuth
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import Foundation
import SwiftUI

/// This device's settings and the account: the Mac Settings window's tabs, and the pages the
/// iPhone and iPad Settings root opens. Every setting saves as it changes; there is no Save.
public struct SettingsScreen: View {
    nonisolated public static let about = "About"

    /// The groups of rows a settings form shows, so the Mac Settings window can spread them over
    /// its tabs. They show in the order of ``all``, except that a form opening stats in a sheet
    /// puts the stats row after the account.
    struct Sections: OptionSet {
        let rawValue: Int

        static let stats = Sections(rawValue: 1 << 0)
        static let instruments = Sections(rawValue: 1 << 1)
        static let musicServices = Sections(rawValue: 1 << 2)
        static let appleMusic = Sections(rawValue: 1 << 3)
        static let appearance = Sections(rawValue: 1 << 4)
        static let recording = Sections(rawValue: 1 << 5)
        static let sync = Sections(rawValue: 1 << 6)
        static let storage = Sections(rawValue: 1 << 7)
        static let account = Sections(rawValue: 1 << 8)
        static let about = Sections(rawValue: 1 << 9)
        static let downloads = Sections(rawValue: 1 << 10)

        static let all: Sections = [
            .stats, .instruments, .musicServices, .appleMusic, .appearance, .recording, .downloads, .sync, .storage,
            .account, .about,
        ]
    }

    private let version: String?
    private let sections: Sections
    private let title: String
    private let opensStatsInSheet: Bool
    private let registersStats: Bool
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system
    @AppStorage(TextSize.storageKey) private var textSizeOffset = 0
    @Environment(\.systemDynamicTypeSize) private var systemTextSize
    @Environment(\.spacing) private var spacing
    @AppStorage(CaptureChannels.storageKey) private var channels: CaptureChannels = .mono
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.store) private var store
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @State private var model: SettingsModel?
    /// Reads no history, so opening Settings never starts the events pull.
    @State private var summary: StatsModel?
    @State private var showsInstruments = false
    /// The sheet's toggles report a refusal while it is up; the row takes it once it is gone.
    @State private var instrumentsShowing = false
    @State private var showsMusicServices = false
    /// The sheet's toggles report a refusal while it is up; the row takes it once it is gone.
    @State private var musicServicesShowing = false
    @State private var showsStats = false

    /// - Parameter version: The app's marketing version, which the About row names.
    public init(version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) {
        self.init(version: version, sections: .all, title: Destination.settings.title, opensStatsInSheet: false)
    }

    /// - Parameters:
    ///   - sections: The groups of rows shown.
    ///   - title: The navigation title.
    ///   - opensStatsInSheet: Shows the stats screen in a sheet rather than pushing it, for a
    ///     form with no stack to push onto.
    ///   - registersStats: Whether the form registers the stats screen's destination. A page
    ///     pushed from a root that registers it once leaves this off.
    init(version: String?, sections: Sections, title: String, opensStatsInSheet: Bool, registersStats: Bool = true) {
        self.registersStats = registersStats
        self.version = version
        self.sections = sections
        self.title = title
        self.opensStatsInSheet = opensStatsInSheet
    }

    /// The stored text size offset held to what the system size leaves, so a shift the system
    /// has since used up steps from where the text actually is.
    nonisolated static func stepperValue(offset: Int, system: DynamicTypeSize) -> Int {
        let range = TextSize.offsetRange(system: system)
        return min(max(offset, range.lowerBound), range.upperBound)
    }

    /// The About row, as `Crosstune 0.7.0`.
    nonisolated static func aboutLine(version: String) -> String {
        "Crosstune \(version)"
    }

    public var body: some View {
        Form {
            if sections.contains(.stats) && !opensStatsInSheet {
                statsSection
            }
            if let model, model.isLoaded {
                if sections.contains(.instruments) { instrumentsSection(model) }
                if sections.contains(.musicServices) { musicServicesSection(model) }
            }
            if sections.contains(.appleMusic), let access = player?.appleMusic?.access {
                AppleMusicSection(access: access)
            }
            if sections.contains(.appearance) {
                appearanceSection
            }
            if let model, model.isLoaded {
                if sections.contains(.recording) { recordingSections(model) }
                if sections.contains(.downloads) { downloadsSections(model) }
                if sections.contains(.sync) { syncSection(model) }
                if sections.contains(.storage) { storageSection(model) }
            }
            if sections.contains(.account), let session {
                AccountSections(session: session)
            }
            // In the Settings window's Account tab the catalog summary follows the account it
            // counts.
            if sections.contains(.stats) && opensStatsInSheet {
                statsSection
            }
            if sections.contains(.about), let version {
                Section(Self.about) {
                    Text(Self.aboutLine(version: version))
                }
            }
        }
        .formStyle(.grouped)
        .sheet(isPresented: $showsInstruments, onDismiss: { instrumentsShowing = false }) {
            if let model { InstrumentsSheet(model: model) }
        }
        .sheet(isPresented: $showsMusicServices, onDismiss: { musicServicesShowing = false }) {
            if let model { MusicServicesSheet(model: model) }
        }
        #if os(macOS)
            .sheet(isPresented: $showsStats) {
                StatsSheet()
            }
        #endif
        .modifier(StatsDestination(isPushed: !opensStatsInSheet && registersStats))
        .navigationTitle(title)
        .task(id: ModelKey(store: store, engine: engine)) {
            model = store.map { SettingsModel(store: $0, engine: engine) }
            summary = sections.contains(.stats) ? store.map { StatsModel(store: $0, engine: nil, history: false) } : nil
        }
    }

    private var appearanceSection: some View {
        Section {
            Picker(Appearance.title, selection: $appearance) {
                ForEach(Appearance.allCases) { Text($0.label).tag($0) }
            }
            // Text on the Mac does not scale with Dynamic Type, so the shift would do nothing.
            #if !os(macOS)
                Stepper(
                    value: Binding {
                        Self.stepperValue(offset: textSizeOffset, system: systemTextSize)
                    } set: {
                        textSizeOffset = $0
                    },
                    in: TextSize.offsetRange(system: systemTextSize)
                ) {
                    LabeledContent(
                        TextSize.title,
                        value: TextSize.valueLabel(system: systemTextSize, offset: textSizeOffset))
                }
                .accessibilityValue(TextSize.valueLabel(system: systemTextSize, offset: textSizeOffset))
            #endif
        } footer: {
            Text(SettingsModel.appearanceFooter)
        }
    }

    /// The catalog in one line, opening the stats screen. Until the rows are read, an empty row
    /// holds the place so the sections below never shift.
    @ViewBuilder private var statsSection: some View {
        if store != nil {
            Section {
                if let line = summary?.summaryLine {
                    if opensStatsInSheet {
                        SettingsFieldRow(title: line, value: "") { showsStats = true }
                            .monospacedDigit()
                    } else {
                        NavigationLink(value: StatsRoute()) {
                            Text(line).monospacedDigit()
                        }
                    }
                } else {
                    Text(verbatim: " ").accessibilityHidden(true)
                }
            }
        }
    }

    private func instrumentsSection(_ model: SettingsModel) -> some View {
        sheetRowSection(
            SettingsModel.instruments, value: model.instrumentSummary, help: SettingsModel.instrumentsHelp,
            failure: instrumentsShowing ? nil : model.instrumentsFailure
        ) {
            model.clearInstrumentsFailure()
            instrumentsShowing = true
            showsInstruments = true
        }
    }

    /// The services searched, and which version a list plays first, under one footer as the
    /// web groups them.
    private func musicServicesSection(_ model: SettingsModel) -> some View {
        Section {
            SettingsFieldRow(title: SettingsModel.musicServices, value: model.searchProvidersSummary) {
                model.clearSearchProvidersFailure()
                musicServicesShowing = true
                showsMusicServices = true
            }
            PlayFirstPicker(model: model)
        } footer: {
            SettingsFooter(
                help: "\(SettingsModel.musicServicesHelp) \(PlayFirstText.help)",
                failure: (musicServicesShowing ? nil : model.searchProvidersFailure) ?? model.playFirstFailure)
        }
    }

    /// A field row that opens a sheet holding the choices, with the setting's help below.
    private func sheetRowSection(
        _ title: String, value: String, help: String, failure: String?, open: @escaping () -> Void
    ) -> some View {
        Section {
            SettingsFieldRow(title: title, value: value, action: open)
        } footer: {
            SettingsFooter(help: help, failure: failure)
        }
    }

    @ViewBuilder private func recordingSections(_ model: SettingsModel) -> some View {
        Section {
            Picker(
                SettingsModel.quality,
                selection: Binding(get: { model.audioQuality }, set: { model.setAudioQuality($0) })
            ) {
                ForEach(Vocabulary.audioQualities, id: \.self) {
                    Text(SettingsModel.qualityLabel($0, channels: channels)).tag($0)
                }
            }
        } header: {
            Text(SettingsModel.recording)
        } footer: {
            SettingsFooter(help: SettingsModel.qualityFooter, failure: model.qualityFailure)
        }
        Section {
            Picker(SettingsModel.channelsTitle, selection: $channels) {
                ForEach(CaptureChannels.allCases) { Text(SettingsModel.channelLabel($0)).tag($0) }
            }
        } footer: {
            SettingsFooter(help: SettingsModel.channelsFooter, failure: nil)
        }
    }

    @ViewBuilder private func downloadsSections(_ model: SettingsModel) -> some View {
        Section {
            Toggle(
                SettingsModel.keepOffline,
                isOn: Binding(get: { model.keepsOffline }, set: { model.setKeepsOffline($0) }))
        } footer: {
            SettingsFooter(help: SettingsModel.keepOfflineFooter, failure: model.keepOfflineFailure)
        }
        Section {
            Text(SettingsModel.localAudioText(model.localAudioBytes))
                .monospacedDigit()
            // While every recording is kept offline, the next pass would only fetch them again.
            Button(SettingsModel.removeDownloads) {
                model.removeDownloads()
            }
            .disabled(model.keepsOffline || model.isRemovingDownloads)
        } footer: {
            SettingsFooter(help: SettingsModel.removeDownloadsFooter, failure: model.removeDownloadsFailure)
        }
    }

    @ViewBuilder private func syncSection(_ model: SettingsModel) -> some View {
        if engine != nil || model.rejectedMessage != nil {
            syncRows(model)
        }
    }

    private func syncRows(_ model: SettingsModel) -> some View {
        Section(SettingsModel.sync) {
            if let engine {
                LabeledContent(SettingsModel.status, value: engine.status.label)
                LabeledContent(SettingsModel.recordings, value: engine.transferStatus.label)
                if let lastSyncedAt = engine.lastSyncedAt {
                    TimelineView(.everyMinute) { context in
                        LabeledContent(
                            SettingsModel.lastSynced,
                            value: SettingsModel.lastSyncedText(lastSyncedAt, now: context.date))
                    }
                }
            }
            if let rejected = model.rejectedMessage {
                Text(rejected)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if engine != nil {
                Button(SettingsModel.syncNow) {
                    Task { await model.syncNow() }
                }
                .disabled(model.isSyncing)
            }
        }
    }

    @ViewBuilder private func storageSection(_ model: SettingsModel) -> some View {
        if let figures = model.storage {
            let text = RecordingText.storageUsed(figures)
            Section(SettingsModel.storage) {
                VStack(alignment: .leading, spacing: spacing.stackGap) {
                    Text(text)
                        .monospacedDigit()
                    ProgressView(value: SettingsModel.storageFraction(figures))
                        .accessibilityLabel(SettingsModel.storageUsed)
                        .accessibilityValue(text)
                }
                .padding(.vertical, spacing(4))
            }
        }
    }
}
