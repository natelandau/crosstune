import CrosstuneAudio
import CrosstuneAuth
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import Foundation
import SwiftUI

/// This device's settings and the account: the iPhone Settings tab, a sidebar row on iPad,
/// and the Settings window on Mac. Every setting saves as it changes; there is no Save.
public struct SettingsScreen: View {
    nonisolated public static let about = "About"

    private let version: String?
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
    @State private var showsInstruments = false
    /// The sheet's toggles report a refusal while it is up; the row takes it once it is gone.
    @State private var instrumentsShowing = false
    @State private var showsMusicServices = false
    /// The sheet's toggles report a refusal while it is up; the row takes it once it is gone.
    @State private var musicServicesShowing = false

    /// - Parameter version: The app's marketing version, which the About row names.
    public init(version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) {
        self.version = version
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
            if let model, model.isLoaded {
                instrumentsSection(model)
                musicServicesSection(model)
            }
            if let access = player?.appleMusic?.access {
                AppleMusicSection(access: access)
            }
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
            if let model, model.isLoaded {
                recordingSections(model)
                syncSection(model)
                storageSection(model)
            }
            if let session {
                AccountSections(session: session)
            }
            if let version {
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
        .navigationTitle(Destination.settings.title)
        .task(id: ModelKey(store: store, engine: engine)) {
            model = store.map { SettingsModel(store: $0, engine: engine) }
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
            Picker(
                PlayFirstText.label,
                selection: Binding(get: { model.playFirst }, set: { model.setPlayFirst($0) })
            ) {
                ForEach(Vocabulary.playFirsts, id: \.self) { Text(PlayFirstText.names[$0] ?? $0).tag($0) }
            }
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
            let text = SettingsModel.storageText(figures)
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

/// What the model is made for: a new store or engine, as after signing in as someone else,
/// needs a new one.
private struct ModelKey: Equatable {
    let store: ObjectIdentifier?
    let engine: ObjectIdentifier?

    init(store: CrosstuneStore?, engine: SyncEngine?) {
        self.store = store.map(ObjectIdentifier.init)
        self.engine = engine.map(ObjectIdentifier.init)
    }
}
