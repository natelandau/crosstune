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
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.store) private var store
    @State private var model: SettingsModel?
    @State private var showsInstruments = false
    /// The sheet's toggles report a refusal while it is up; the row takes it once it is gone.
    @State private var instrumentsShowing = false

    /// - Parameter version: The app's marketing version, which the About row names.
    public init(version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) {
        self.version = version
    }

    /// The About row, as `Crosstune 0.7.0`.
    nonisolated static func aboutLine(version: String) -> String {
        "Crosstune \(version)"
    }

    public var body: some View {
        Form {
            if let model, model.isLoaded {
                instrumentsSection(model)
            }
            Section {
                Picker(Appearance.title, selection: $appearance) {
                    ForEach(Appearance.allCases) { Text($0.label).tag($0) }
                }
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
        .navigationTitle(Destination.settings.title)
        .task(id: ModelKey(store: store, engine: engine)) {
            model = store.map { SettingsModel(store: $0, engine: engine) }
        }
    }

    private func instrumentsSection(_ model: SettingsModel) -> some View {
        Section {
            Button {
                model.clearInstrumentsFailure()
                instrumentsShowing = true
                showsInstruments = true
            } label: {
                HStack {
                    LabeledContent(SettingsModel.instruments, value: model.instrumentSummary)
                    Image(systemName: "chevron.forward")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        } footer: {
            SettingsFooter(
                help: SettingsModel.instrumentsHelp, failure: instrumentsShowing ? nil : model.instrumentsFailure)
        }
    }

    @ViewBuilder private func recordingSections(_ model: SettingsModel) -> some View {
        Section {
            Picker(
                SettingsModel.quality,
                selection: Binding(get: { model.audioQuality }, set: { model.setAudioQuality($0) })
            ) {
                ForEach(Vocabulary.audioQualities, id: \.self) { Text(SettingsModel.qualityLabel($0)).tag($0) }
            }
        } header: {
            Text(SettingsModel.recording)
        } footer: {
            SettingsFooter(help: SettingsModel.qualityFooter, failure: model.qualityFailure)
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
                VStack(alignment: .leading, spacing: 8) {
                    Text(text)
                        .monospacedDigit()
                    ProgressView(value: SettingsModel.storageFraction(figures))
                        .accessibilityLabel(SettingsModel.storageUsed)
                        .accessibilityValue(text)
                }
                .padding(.vertical, 4)
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
