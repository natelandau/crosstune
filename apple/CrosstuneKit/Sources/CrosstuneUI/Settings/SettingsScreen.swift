import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneAuth
import CrosstuneDesign
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
        static let appleMusic = Sections(rawValue: 1 << 3)
        static let appearance = Sections(rawValue: 1 << 4)
        static let recording = Sections(rawValue: 1 << 5)
        static let sync = Sections(rawValue: 1 << 6)
        static let storage = Sections(rawValue: 1 << 7)
        static let account = Sections(rawValue: 1 << 8)
        static let about = Sections(rawValue: 1 << 9)
        static let downloads = Sections(rawValue: 1 << 10)
        static let newTunes = Sections(rawValue: 1 << 11)
        static let importExport = Sections(rawValue: 1 << 12)
        static let plan = Sections(rawValue: 1 << 13)
        /// The instruments as a toggle each.
        static let instrumentToggles = Sections(rawValue: 1 << 14)
        /// The music services as a toggle each, then Play first.
        static let serviceToggles = Sections(rawValue: 1 << 15)
        /// The saved locations as a group of rows, each opening its location.
        static let savedLocations = Sections(rawValue: 1 << 16)
        /// The reference pitch.
        static let tuner = Sections(rawValue: 1 << 17)

        static let all: Sections = [
            .stats, .instrumentToggles, .newTunes, .serviceToggles, .appleMusic, .appearance, .recording,
            .savedLocations, .downloads, .tuner, .sync, .storage, .importExport, .plan, .account, .about,
        ]
    }

    nonisolated static let downloads = "Downloads"
    #if os(macOS)
        /// The downloaded audio row's button, beside the row that names the audio.
        nonisolated static let removeMac = "Remove"
    #endif

    private let version: String?
    private let sections: Sections
    private let title: String
    private let opensStatsInSheet: Bool
    private let registersStats: Bool
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system
    @AppStorage(TextSize.storageKey) private var textSizeOffset = 0
    @Environment(\.systemDynamicTypeSize) private var systemTextSize
    @AppStorage(CaptureChannels.storageKey) private var channels: CaptureChannels = .mono
    @AppStorage(UsageData.storageKey) private var sharesUsageData = false
    @Environment(\.analytics) private var analytics
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.store) private var store
    @Environment(\.plan) private var planModel: PlanModel?
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @State private var model: SettingsModel?
    /// Reads no history, so opening Settings never starts the events pull.
    @State private var summary: LiveQuery<StatsSummary?>?
    @State private var showsStats = false
    #if os(macOS)
        /// The music services sheet, which only a sample launch opens over the Tunes tab.
        @State private var showsMusicServices = false
        /// The sheet's toggles report a refusal while it is up; the tab takes it once it is gone.
        @State private var musicServicesShowing = false
    #else
        /// The saved locations, read only while the form shows their group.
        @State private var savedLocations: SavedLocationsModel?
    #endif

    /// - Parameters:
    ///   - version: The app's marketing version, which the About row names.
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

    private var plan: Plan { planModel?.plan ?? .unknown }

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
        form
            #if os(macOS)
                .sheet(isPresented: $showsMusicServices, onDismiss: { musicServicesShowing = false }) {
                    if let model { MusicServicesSheet(model: model) }
                }
                .sheet(isPresented: $showsStats) {
                    StatsSheet()
                }
            #endif
            #if DEBUG && os(macOS)
                .opensForSample(.musicServices, when: sections.contains(.serviceToggles) && model?.isLoaded == true) {
                    showsMusicServices = true
                }
                .opensForSample(.stats, when: sections.contains(.stats) && opensStatsInSheet) { showsStats = true }
            #endif
            .modifier(StatsDestination(isPushed: !opensStatsInSheet && registersStats))
            #if !os(macOS)
                .navigationDestination(for: SavedLocationRoute.self) { route in
                    if let savedLocations { SavedLocationDetail(model: savedLocations, placeID: route.id) }
                }
            #endif
            .navigationTitle(title)
            .task(id: ModelKey(store: store, engine: engine)) {
                model = store.map { SettingsModel(store: $0, engine: engine, analytics: analytics) }
                summary = sections.contains(.stats) ? store.map(StatsSummary.live) : nil
                #if !os(macOS)
                    savedLocations =
                        sections.contains(.savedLocations)
                        ? store.map { SavedLocationsModel(store: $0, analytics: analytics) } : nil
                #endif
            }
    }

    /// The appearance as the musician changes it, which is what reports.
    private var appearanceBinding: Binding<Appearance> {
        Binding(
            get: { appearance },
            set: {
                guard $0 != appearance else { return }
                appearance = $0
                analytics.send(.settingChanged(.appearance(AppearanceChoice($0))))
            })
    }

    /// The recording channels as the musician changes them, which is what reports.
    private var channelsBinding: Binding<CaptureChannels> {
        Binding(
            get: { channels },
            set: {
                guard $0 != channels else { return }
                channels = $0
                analytics.send(.settingChanged(.captureChannels(ChannelChoice($0))))
            })
    }

    #if os(macOS)
        /// The groups as cards on the page background, scrolling, with no grouped `Form`: its rows draw a
        /// second label and its row buttons a ring around the whole card.
        private var form: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                    macSections
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(MacStyle.sheetMargin)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(Palette.pageBackground)
        }
    #else
        private var form: some View {
            GroupedForm {
                if sections.contains(.stats) && !opensStatsInSheet {
                    statsSection
                }
                if let model, model.isLoaded {
                    if sections.contains(.instrumentToggles) {
                        InstrumentsChoices(model: model, title: SettingsModel.instruments)
                    }
                    if sections.contains(.newTunes) { newTunesSections(model) }
                    if sections.contains(.serviceToggles) { serviceToggleSections(model) }
                }
                if sections.contains(.appleMusic), let access = player?.appleMusic?.access {
                    AppleMusicSection(access: access)
                }
                if sections.contains(.appearance) {
                    appearanceSection
                }
                if let model, model.isLoaded, sections.contains(.recording) {
                    recordingSections(model)
                }
                if sections.contains(.savedLocations) {
                    SavedLocationsSection(model: savedLocations)
                }
                if let model, model.isLoaded {
                    if sections.contains(.downloads) { downloadsSections(model) }
                    if sections.contains(.tuner) { tunerSection(model) }
                    if sections.contains(.sync) { syncSection(model) }
                    if sections.contains(.storage) { storageSection(model) }
                }
                if sections.contains(.importExport) {
                    ImportExportSections()
                }
                if sections.contains(.plan) {
                    PlanSection(plan: plan, storage: model?.storage(plan: plan))
                }
                if sections.contains(.account), let session {
                    AccountSections(session: session)
                }
                // In the Settings window's Account tab the catalog summary follows the account it
                // counts.
                if sections.contains(.stats) && opensStatsInSheet {
                    statsSection
                }
                if sections.contains(.about) {
                    Section {
                        if let version {
                            Text(Self.aboutLine(version: version))
                        }
                    } header: {
                        Text(Self.about)
                    }
                    Section {
                        Toggle(UsageData.title, isOn: UsageData.toggle($sharesUsageData, analytics: analytics))
                    } header: {
                        SettingsHelp(UsageData.help)
                    }
                }
            }
        }

        private var appearanceSection: some View {
            Section {
                Picker(Appearance.title, selection: appearanceBinding) {
                    ForEach(Appearance.allCases) { Text($0.label).tag($0) }
                }
                Stepper(
                    value: Binding {
                        Self.stepperValue(offset: textSizeOffset, system: systemTextSize)
                    } set: {
                        guard $0 != textSizeOffset else { return }
                        textSizeOffset = $0
                        analytics.send(.settingChanged(.textSize($0)))
                    },
                    in: TextSize.offsetRange(system: systemTextSize)
                ) {
                    LabeledContent(
                        TextSize.title,
                        value: TextSize.valueLabel(system: systemTextSize, offset: textSizeOffset))
                }
                .accessibilityValue(TextSize.valueLabel(system: systemTextSize, offset: textSizeOffset))
            } header: {
                SettingsHelp(SettingsModel.appearanceHelp)
            }
        }

        /// The catalog in one line, opening the stats screen. Until the rows are read, an empty row
        /// holds the place so the sections below never shift.
        @ViewBuilder private var statsSection: some View {
            if store != nil {
                Section {
                    if let line = (summary?.value ?? nil)?.line {
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

        /// The status and genre every new tune starts with, each a picker row.
        private func newTunesSections(_ model: SettingsModel) -> some View {
            Section {
                let status = Binding(
                    get: { StatusField.chosen(model.newTuneStatus) }, set: { model.setNewTuneStatus($0) })
                Picker(TuneFieldLabels.status, selection: status) {
                    ForEach(StatusField.segments, id: \.value) { Text($0.label).tag($0.value) }
                }
                SuggestionField(
                    TuneFieldLabels.genre,
                    value: Binding(get: { model.newTuneGenre }, set: { model.setNewTuneGenre($0) }),
                    suggestions: Vocabulary.genres, maxLength: Vocabulary.Limits.Tune.genre)
            } header: {
                SettingsHelp(SettingsModel.newTunesHelp, title: SettingsModel.newTunes)
            } footer: {
                SettingsFailure(model.newTuneStatusFailure ?? model.newTuneGenreFailure)
            }
        }

        /// The services searched as a toggle each, then which version a list plays first.
        @ViewBuilder private func serviceToggleSections(_ model: SettingsModel) -> some View {
            MusicServicesChoices(model: model, title: SettingsModel.musicServices)
            Section {
                PlayFirstPicker(model: model)
            } header: {
                SettingsHelp(PlayFirstText.help)
            } footer: {
                SettingsFailure(model.playFirstFailure)
            }
        }

        @ViewBuilder private func recordingSections(_ model: SettingsModel) -> some View {
            Section {
                let quality = Binding(get: { model.audioQuality }, set: { model.setAudioQuality($0) })
                Picker(SettingsModel.quality, selection: quality) {
                    ForEach(Vocabulary.audioQualities, id: \.self) {
                        Text(SettingsModel.qualityLabel($0, channels: channels)).tag($0)
                    }
                }
            } header: {
                SettingsHelp(SettingsModel.qualityHelp, title: SettingsModel.recording)
            } footer: {
                SettingsFailure(model.qualityFailure)
            }
            Section {
                Picker(SettingsModel.channelsTitle, selection: channelsBinding) {
                    ForEach(CaptureChannels.allCases) { Text(SettingsModel.channelLabel($0)).tag($0) }
                }
            } header: {
                SettingsHelp(SettingsModel.channelsHelp)
            }
            LocationAccessSection(helpAbove: true)
        }

        private func tunerSection(_ model: SettingsModel) -> some View {
            Section {
                let hz = Binding(get: { model.tunerA4Hz }, set: { model.setTunerA4Hz($0) })
                Stepper(value: hz, in: Vocabulary.Ranges.UserSettings.tunerA4Hz) {
                    LabeledContent(
                        SettingsModel.referencePitch, value: SettingsModel.referencePitchLabel(model.tunerA4Hz))
                }
                .accessibilityValue(SettingsModel.referencePitchLabel(model.tunerA4Hz))
            } header: {
                SettingsHelp(nil, title: SettingsModel.tuner)
            } footer: {
                SettingsFailure(model.tunerA4HzFailure)
            }
        }

        @ViewBuilder private func downloadsSections(_ model: SettingsModel) -> some View {
            Section {
                Toggle(
                    SettingsModel.keepOffline,
                    isOn: Binding(get: { model.keepsOffline }, set: { model.setKeepsOffline($0) }))
            } header: {
                SettingsHelp(SettingsModel.keepOfflineHelp, title: Self.downloads)
            } footer: {
                SettingsFailure(model.keepOfflineFailure)
            }
            Section {
                Text(SettingsModel.localAudioText(model.localAudioBytes))
                    .monospacedDigit()
                // While every recording is kept offline, the next pass would only fetch them again.
                Button(SettingsModel.removeDownloads) {
                    model.removeDownloads()
                }
                .disabled(model.keepsOffline || model.isRemovingDownloads)
            } header: {
                SettingsHelp(SettingsModel.removeDownloadsHelp)
            } footer: {
                SettingsFailure(model.removeDownloadsFailure)
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
                    LabeledContent(
                        SettingsModel.status,
                        value: SettingsModel.statusText(engine.status, updateRequired: session?.updateRequired ?? false)
                    )
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
                        .font(.platform(.footnote))
                        .foregroundStyle(.textSecondary)
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
            if let usage = model.storage(plan: plan) {
                Section(SettingsModel.storage) {
                    StorageMeter(storage: usage)
                }
            }
        }
    #endif
}

#if os(macOS)
    /// The Mac's groups: a ``MacFormSection`` card each, every row a ``MacSettingsRow`` with its
    /// help under its name, and the sets answered once as toggles in the tab.
    extension SettingsScreen {
        @ViewBuilder fileprivate var macSections: some View {
            if let model, model.isLoaded {
                if sections.contains(.instrumentToggles) { macInstruments(model) }
                if sections.contains(.newTunes) { macNewTunes(model) }
                if sections.contains(.serviceToggles) { macServices(model) }
            }
            if sections.contains(.appleMusic), let access = player?.appleMusic?.access {
                AppleMusicSection(access: access)
            }
            if sections.contains(.appearance) {
                macAppearance
            }
            if let model, model.isLoaded {
                if sections.contains(.recording) { macRecording(model) }
            }
            if sections.contains(.savedLocations) {
                MacSavedLocationsSection()
            }
            if let model, model.isLoaded {
                if sections.contains(.downloads) { macDownloads(model) }
                if sections.contains(.tuner) { macTuner(model) }
                if sections.contains(.sync) { macSync(model) }
                if sections.contains(.storage) { macStorage(model) }
            }
            if sections.contains(.importExport) {
                ImportExportSections()
            }
            if sections.contains(.plan) {
                PlanSection(plan: plan, storage: model?.storage(plan: plan))
            }
            if sections.contains(.account), let session {
                // The catalog summary follows the account it counts; deleting the account stays last.
                AccountSections(session: session) {
                    if sections.contains(.stats) { macStats }
                }
            } else if sections.contains(.stats) {
                macStats
            }
            if sections.contains(.about) {
                macAbout
            }
        }

        private func macInstruments(_ model: SettingsModel) -> some View {
            MacFormSection(
                SettingsModel.instruments, subtitle: SettingsModel.instrumentsHelp, failure: model.instrumentsFailure
            ) {
                ForEach(Vocabulary.instruments, id: \.self) { instrument in
                    let label = InstrumentsChoices.label(instrument)
                    MacSettingsRow(label) {
                        MacSettingsSwitch(label, isOn: InstrumentsChoices.binding(instrument, model: model))
                    }
                }
            }
        }

        /// The status and genre every new tune starts with.
        private func macNewTunes(_ model: SettingsModel) -> some View {
            MacFormSection(
                SettingsModel.newTunes, subtitle: SettingsModel.newTunesHelp,
                failure: model.newTuneStatusFailure ?? model.newTuneGenreFailure
            ) {
                MacSettingsRow(TuneFieldLabels.status) {
                    MacPopUp(
                        TuneFieldLabels.status,
                        selection: Binding(
                            get: { StatusField.chosen(model.newTuneStatus) }, set: { model.setNewTuneStatus($0) }),
                        options: StatusField.segments.map(\.value), label: StatusStyle.label)
                }
                MacSettingsRow(TuneFieldLabels.genre) {
                    SuggestionField(
                        TuneFieldLabels.genre,
                        value: Binding(get: { model.newTuneGenre }, set: { model.setNewTuneGenre($0) }),
                        suggestions: Vocabulary.genres, maxLength: Vocabulary.Limits.Tune.genre
                    )
                    .frame(width: MacSettingsRow<EmptyView>.fieldWidth)
                }
            }
        }

        /// The services searched, then which version a list plays first, each with its own help.
        @ViewBuilder private func macServices(_ model: SettingsModel) -> some View {
            MacMusicServicesSection(model: model, showsFailure: !musicServicesShowing)
            MacFormSection(failure: model.playFirstFailure) {
                MacSettingsRow(PlayFirstText.label, help: PlayFirstText.help) {
                    PlayFirstPicker(model: model)
                }
            }
        }

        private var macAppearance: some View {
            // The row names the group, so the card takes no heading.
            MacFormSection {
                MacSettingsRow(Appearance.title, help: SettingsModel.appearanceHelp) {
                    MacPopUp(
                        Appearance.title,
                        selection: appearanceBinding,
                        options: Appearance.allCases, label: \.label)
                }
            }
        }

        private func macRecording(_ model: SettingsModel) -> some View {
            MacFormSection(SettingsModel.recording, failure: model.qualityFailure) {
                MacSettingsRow(SettingsModel.quality, help: SettingsModel.qualityHelp) {
                    MacPopUp(
                        SettingsModel.quality,
                        selection: Binding(get: { model.audioQuality }, set: { model.setAudioQuality($0) }),
                        options: Vocabulary.audioQualities,
                        label: { SettingsModel.qualityLabel($0, channels: channels) })
                }
                MacSettingsRow(SettingsModel.channelsTitle, help: SettingsModel.channelsHelp) {
                    MacPopUp(
                        SettingsModel.channelsTitle,
                        selection: channelsBinding,
                        options: CaptureChannels.allCases, label: SettingsModel.channelLabel)
                }
                MacLocationAccessRow()
            }
        }

        private func macTuner(_ model: SettingsModel) -> some View {
            let range = Vocabulary.Ranges.UserSettings.tunerA4Hz
            return MacFormSection(SettingsModel.tuner, failure: model.tunerA4HzFailure) {
                MacSettingsRow(SettingsModel.referencePitch) {
                    MacStepper(
                        value: SettingsModel.referencePitchLabel(model.tunerA4Hz),
                        decrement: { model.setTunerA4Hz(model.tunerA4Hz - 1) },
                        increment: { model.setTunerA4Hz(model.tunerA4Hz + 1) },
                        canDecrement: model.tunerA4Hz > range.lowerBound,
                        canIncrement: model.tunerA4Hz < range.upperBound,
                        accessibilityLabel: SettingsModel.referencePitch)
                }
            }
        }

        private func macDownloads(_ model: SettingsModel) -> some View {
            MacFormSection(Self.downloads, failure: model.keepOfflineFailure ?? model.removeDownloadsFailure) {
                MacSettingsRow(SettingsModel.keepOffline, help: SettingsModel.keepOfflineHelp) {
                    MacSettingsSwitch(
                        SettingsModel.keepOffline,
                        isOn: Binding(get: { model.keepsOffline }, set: { model.setKeepsOffline($0) }))
                }
                MacSettingsRow(
                    SettingsModel.localAudioText(model.localAudioBytes), help: SettingsModel.removeDownloadsHelp
                ) {
                    MacSettingsButton(Self.removeMac) { model.removeDownloads() }
                        .accessibilityLabel(SettingsModel.removeDownloads)
                        // While every recording is kept offline, the next pass would only fetch them again.
                        .disabled(model.keepsOffline || model.isRemovingDownloads)
                }
            }
        }

        @ViewBuilder private func macSync(_ model: SettingsModel) -> some View {
            if engine != nil || model.rejectedMessage != nil {
                MacFormSection(SettingsModel.sync, subtitle: model.rejectedMessage) {
                    if let engine {
                        TimelineView(.everyMinute) { context in
                            MacSettingsRow(
                                SettingsModel.status,
                                help: engine.lastSyncedAt.map {
                                    "\(SettingsModel.lastSynced) \(SettingsModel.lastSyncedText($0, now: context.date, inSentence: true))"
                                }
                            ) {
                                HStack(spacing: 12) {
                                    MacSettingsValue(
                                        SettingsModel.statusText(
                                            engine.status, updateRequired: session?.updateRequired ?? false))
                                    MacSettingsButton(SettingsModel.syncNow) {
                                        Task { await model.syncNow() }
                                    }
                                    .disabled(model.isSyncing)
                                }
                            }
                        }
                        MacSettingsRow(SettingsModel.recordings) {
                            MacSettingsValue(engine.transferStatus.label)
                        }
                    }
                }
            }
        }

        @ViewBuilder private func macStorage(_ model: SettingsModel) -> some View {
            if let usage = model.storage(plan: plan) {
                MacFormSection(SettingsModel.storage) {
                    StorageMeter(storage: usage)
                }
            }
        }

        /// The catalog in one line, as the stats row's value. The row shows before the line is
        /// read, so the cards below never shift.
        @ViewBuilder private var macStats: some View {
            if store != nil {
                MacFormSection {
                    MacSettingsLinkRow(StatsCopy.title, value: (summary?.value ?? nil)?.line) { showsStats = true }
                }
            }
        }

        private var macAbout: some View {
            MacFormSection(Self.about) {
                if let version {
                    MacSettingsRow(Self.aboutLine(version: version)) { EmptyView() }
                }
                MacSettingsRow(UsageData.title, help: UsageData.help) {
                    MacSettingsSwitch(UsageData.title, isOn: UsageData.toggle($sharesUsageData, analytics: analytics))
                }
            }
        }
    }
#endif
