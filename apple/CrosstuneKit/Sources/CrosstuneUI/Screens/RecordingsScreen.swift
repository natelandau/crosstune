import CrosstuneStore
import CrosstuneSync
import SwiftUI
import UniformTypeIdentifiers

/// Every recording the musician has made or uploaded, under the account's storage: the unfiled
/// ones, then the filed ones, sorted and searched as the musician asks. iPhone's Recordings tab
/// and the sidebar's Recordings.
public struct RecordingsScreen: View {
    public static let emptyTitle = "No recordings yet"
    public static let emptyHint = "Use the record button to make one, or upload an audio file."
    /// The heading over captures that were never saved as recordings.
    public static let unfinishedHeader = "Not saved"

    @Environment(RecordingsModel.self) private var model: RecordingsModel?

    public init() {}

    public var body: some View {
        Group {
            if let model {
                RecordingsContent(model: model)
            } else {
                // Loading is silence.
                Color.clear
            }
        }
        .navigationTitle(Destination.recordings.title)
    }
}

/// One choice per sort, the current one checked; choosing it again reverses it. The recordings
/// screen's Sort menu and the menu bar's View > Sort By.
public struct RecordingSortChoices: View {
    @Binding var choice: SortChoice

    public init(choice: Binding<SortChoice>) {
        _choice = choice
    }

    /// One menu item: the sort it picks, and for the current one its direction.
    struct Item: Equatable {
        let sort: RecordingSort
        let label: String
        let isChecked: Bool
        let direction: String?
        let directionSymbol: String?
    }

    nonisolated static func items(for choice: SortChoice) -> [Item] {
        RecordingSort.allCases.map { sort in
            let checked = choice.sort == sort
            return Item(
                sort: sort, label: RecordingsListText.label(sort), isChecked: checked,
                direction: checked ? RecordingsListText.direction(choice) : nil,
                directionSymbol: checked ? RecordingsListText.directionSymbol(choice) : nil)
        }
    }

    /// What a toggle of `sort` leaves chosen. Choosing the checked item turns its toggle off,
    /// which still reverses the sort rather than leaving nothing chosen.
    nonisolated static func toggled(_ sort: RecordingSort, isOn _: Bool, from choice: SortChoice) -> SortChoice {
        choice.picking(sort)
    }

    public var body: some View {
        ForEach(Self.items(for: choice), id: \.sort) { item in
            // A toggle, so the check reads as the choice's state rather than as an icon.
            Toggle(
                isOn: Binding {
                    item.isChecked
                } set: { isOn in
                    choice = Self.toggled(item.sort, isOn: isOn, from: choice)
                }
            ) {
                if let direction = item.direction, let symbol = item.directionSymbol {
                    // A menu shows the second text as the item's subtitle, which VoiceOver reads
                    // after its title.
                    Label {
                        Text(item.label)
                        Text(direction)
                    } icon: {
                        Image(systemName: symbol)
                    }
                } else {
                    Text(item.label)
                }
            }
        }
    }
}

/// How much of the account's audio quota is spent.
struct StorageSummary: View {
    let storage: StorageFigures

    @Environment(\.spacing) private var spacing

    var body: some View {
        let text = SettingsModel.storageText(storage)
        VStack(alignment: .leading, spacing: spacing(6)) {
            Text(text)
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
            ProgressView(value: SettingsModel.storageFraction(storage))
                .accessibilityLabel(SettingsModel.storageUsed)
                .accessibilityValue(text)
        }
        .accessibilityElement(children: .contain)
    }
}

private struct RecordingsContent: View {
    @Bindable var model: RecordingsModel

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.detailTune) private var detailTune
    @Environment(\.spacing) private var spacing
    @Environment(\.openURL) private var openURL
    @Environment(\.openSheets) private var openSheets
    @AppStorage(SortChoice.storageKey) private var sort = SortChoice.default
    @FocusState private var searchFocused: Bool
    @State private var isShown = false
    @State private var pushed: String?
    /// Whether the pushed tune opened from its tune label line, the one place that marks a zoom
    /// source; a flat row's tune line and Go to tune share a tune with other rows.
    @State private var pushZooms = false
    @State private var importing = false
    @State private var dropTargeted = false
    @State private var showsFilters = false
    @State private var filing: RecordingView?
    @State private var editing: RecordingView?
    /// A tune the add to tune sheet asked to start, with the recording to file under it, opened
    /// once that sheet has gone.
    @State private var creating: (recordingID: String, target: TuneFormTarget)?
    @State private var form: CreatingTune?
    @State private var deleting: RecordingView?
    @State private var discarding: RecordingFile?
    @Namespace private var zoom

    /// The tune form opened from the add to tune sheet, and the recording it files once saved.
    private struct CreatingTune: Identifiable {
        let recordingID: String
        let target: TuneFormTarget

        var id: TuneFormTarget { target }
    }

    var body: some View {
        let arrangement = model.arrangement(sort)
        let sheetsOpen = openSheets?.isCovered == true
        List {
            if model.filterCount > 0 {
                RecordingsFilterBar(choice: model.choice) {
                    Task { await model.resetSource() }
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
            if let storage = model.storage {
                Section {
                    StorageSummary(storage: storage)
                }
            }
            if model.showsUnfinished {
                Section(RecordingsScreen.unfinishedHeader) {
                    ForEach(model.unfinished, id: \.id) { capture in
                        unfinishedRow(capture)
                    }
                }
            }
            if let arrangement {
                if !arrangement.unfiled.isEmpty {
                    Section(RecordingsListText.unfiled) {
                        ForEach(arrangement.unfiled) { view in
                            row(view)
                        }
                    }
                }
                filedSection(arrangement.filed)
            }
        }
        .overlay {
            Group {
                if model.hasNoRecordings && model.unfinished.isEmpty {
                    ContentUnavailableView {
                        Label(RecordingsScreen.emptyTitle, systemImage: Destination.recordings.systemImage)
                    } description: {
                        Text(RecordingsScreen.emptyHint)
                    }
                } else if model.showsNothingMatches(arrangement) {
                    ContentUnavailableView(RecordingsListText.nothingMatches, systemImage: "magnifyingglass")
                }
            }
            // A set source's capsule above stays pressable.
            .allowsHitTesting(false)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if let failure = model.failure {
                Text(failure)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, spacing.stackGap)
            }
        }
        .safeAreaBar(edge: .top) {
            HStack(spacing: spacing.stackGap) {
                FilterSearchField(
                    prompt: RecordingsListText.search, query: $model.query, isFocused: $searchFocused,
                    filterCount: model.filterCount, filtersGate: model.filtersGate,
                    onSubmit: { searchFocused = false }
                ) { showsFilters = true }
                #if os(macOS)
                    // The screen's own actions share its search's bar, as the catalog's do.
                    Group {
                        sortMenu.labelStyle(.iconOnly)
                        uploadButton.labelStyle(.iconOnly)
                    }
                    .paneControls()
                #endif
            }
            .padding(.horizontal, 16)
            .padding(.bottom, spacing.stackGap)
        }
        #if os(iOS)
            .toolbar {
                ToolbarItem(placement: .primaryAction) { sortMenu }
                ToolbarItem(placement: .primaryAction) { uploadButton }
            }
        #endif
        .coversShell(importing)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.audio], allowsMultipleSelection: true) {
            result in
            switch result {
            case .success(let urls): Task { await model.importAudio(from: urls) }
            case .failure(let error): model.report(error)
            }
        }
        #if os(macOS)
            .dropDestination(for: URL.self) { urls, _ in
                // A link dragged from a browser arrives as a URL too, and has no file to add.
                let files = urls.filter(\.isFileURL)
                guard !files.isEmpty else { return false }
                Task { await model.importAudio(from: files) }
                return true
            } isTargeted: {
                dropTargeted = $0
            }
            .overlay {
                if dropTargeted {
                    Rectangle().strokeBorder(.tint, lineWidth: 2).allowsHitTesting(false)
                }
            }
        #endif
        .modifier(RefreshesBySync(engine: engine))
        .modifier(PushesTune(tuneID: $pushed, isPushing: detailTune == nil, zoom: pushZooms ? zoom : nil))
        .sheet(isPresented: $showsFilters) {
            RecordingsFilterSheet(model: model)
        }
        .sheet(item: $editing) { view in
            EditRecordingSheet(view: view)
        }
        .sheet(item: $filing, onDismiss: openCreated) { view in
            AddToTuneSheet(recordingID: view.id) { title in
                creating = (view.id, .new(title: title))
            }
        }
        .sheet(item: $form) { creating in
            TuneFormSheet(target: creating.target) { tuneID in
                Task { await file(creating.recordingID, under: tuneID) }
            }
        }
        .coversShell(deleting != nil)
        .confirmationDialog(
            RecordingsModel.deleteTitle,
            isPresented: Binding {
                deleting != nil
            } set: {
                if !$0 { deleting = nil }
            },
            titleVisibility: .visible, presenting: deleting
        ) { view in
            Button(RecordingRowActions.delete, role: .destructive) { delete(view) }
        } message: { view in
            Text(RecordingsModel.deleteMessage(view))
        }
        .onAppear { isShown = true }
        .onDisappear {
            isShown = false
            model.clearFailure()
        }
        .onChange(of: pushed) { _, tuneID in
            if tuneID == nil { pushZooms = false }
        }
        // A tab the musician is not looking at stays alive, so it must not answer the menu.
        .focusedSceneValue(\.recordingsSort, MenuGates.sort(isShown: isShown, sheetsOpen: sheetsOpen) ? $sort : nil)
        .focusedSceneValue(
            \.findAction,
            MenuGates.find(isShown: isShown, sheetsOpen: sheetsOpen) ? MenuAction { searchFocused = true } : nil
        )
        .coversShell(discarding != nil)
        .confirmationDialog(
            RecordingsModel.deleteTitle,
            isPresented: Binding {
                discarding != nil
            } set: {
                if !$0 { discarding = nil }
            },
            titleVisibility: .visible, presenting: discarding
        ) { capture in
            Button(RecordingRowActions.delete, role: .destructive) {
                Task { await model.discard(capture) }
            }
        } message: { _ in
            Text(RecordingsModel.deleteUnsyncedNote)
        }
    }

    private var sortMenu: some View {
        Menu(RecordingsListText.sort, systemImage: "arrow.up.arrow.down") {
            RecordingSortChoices(choice: $sort)
        }
        .help(RecordingsListText.sort)
    }

    /// The filed recordings in one section: flat, each row naming its tune, or under a line per
    /// tune.
    @ViewBuilder private func filedSection(_ filed: FiledRecordings) -> some View {
        switch filed {
        case .flat(let views):
            if !views.isEmpty {
                Section(RecordingsListText.filed) {
                    ForEach(views) { view in
                        row(view, opensTune: true)
                    }
                }
            }
        case .byTune(let tunes):
            if !tunes.isEmpty {
                Section(RecordingsListText.filed) {
                    ForEach(tunes) { tune in
                        tuneLabel(tune)
                        ForEach(tune.views) { view in
                            row(view)
                        }
                    }
                }
            }
        }
    }

    private var uploadButton: some View {
        Button(RecordingImport.upload, systemImage: "square.and.arrow.down") { importing = true }
            .help(RecordingImport.uploadAudio)
            .accessibilityLabel(RecordingImport.uploadAudio)
    }

    /// A recording's row. A filed one names its tune in a tune line when `opensTune`, and
    /// otherwise sits under a line naming it; either way its title never falls back to the tune.
    private func row(_ view: RecordingView, opensTune: Bool = false) -> some View {
        let open = view.tuneID.map { tuneID in { openTune(tuneID) } }
        return RecordingItem(
            view: view, tuneNamedAbove: view.tuneID != nil, storage: model.storage, sort: sort.sort,
            onOpenTune: opensTune ? open : nil
        ) { kind in
            retry(view.id, kind)
        }
        .scaledRowInsets()
        .recordingRowActions(
            filed: view.tuneID != nil,
            originLabel: RecordingText.originLabel(view.recording.origin),
            onOpenOrigin: RecordingRowActions.originPage(view.recording).map { page in { openURL(page) } },
            onEdit: { editing = view },
            onAddToTune: { filing = view },
            onRemoveFromTune: { Task { await model.removeFromTune(view.id) } },
            onGoToTune: open,
            onDelete: { deleting = view })
    }

    /// The line over one tune's recordings under Tune sort. The whole line opens the tune.
    private func tuneLabel(_ tune: TuneRecordings) -> some View {
        Button {
            openTune(tune.tuneID, zooms: true)
        } label: {
            HStack(spacing: 4) {
                Text(tune.tuneTitle)
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .imageScale(.small)
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
            }
            .font(.footnote.bold())
            .foregroundStyle(.secondary)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .matchedTransitionSource(id: tune.tuneID, in: zoom)
        .accessibilityAddTraits(.isHeader)
    }

    /// Opens a tune: pushed on iPhone, in the detail column on iPad and Mac. Only a push from a
    /// tune label line zooms.
    private func openTune(_ tuneID: String, zooms: Bool = false) {
        if let detailTune {
            detailTune.wrappedValue = tuneID
        } else {
            pushZooms = zooms
            pushed = tuneID
        }
    }

    private func unfinishedRow(_ capture: RecordingFile) -> some View {
        let row = UnfinishedCaptureRowContent(capture: capture)
        let discard = Button(RecordingRowActions.delete, systemImage: "trash", role: .destructive) {
            discarding = capture
        }
        return MediaRow(
            glyph: .attention, title: row.title, secondLine: .text(UnfinishedCaptureRowContent.note),
            verb: row.verb, action: { discarding = capture }
        )
        .scaledRowInsets()
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { discard }
        .contextMenu { discard }
    }

    private func retry(_ recordingID: String, _ kind: RecordingText.Retry) {
        guard let transfers else { return }
        Task {
            do {
                try await transfers.retry(recordingID, kind)
            } catch {
                model.report(error)
            }
        }
    }

    private func delete(_ view: RecordingView) {
        // The player lets go of the audio before its file goes.
        if player?.holds(.recording, id: view.id) == true { player?.close() }
        Task { await model.delete(view.id) }
    }

    private func openCreated() {
        guard let creating else { return }
        form = CreatingTune(recordingID: creating.recordingID, target: creating.target)
        self.creating = nil
    }

    private func file(_ recordingID: String, under tuneID: String) async {
        await model.run { commands in
            do {
                try await commands.updateRecording(recordingID, tuneID: .value(tuneID))
            } catch {
                throw FilingFailed()
            }
        }
    }

    /// A filing under a tune started from the add to tune sheet, reported once the sheet has
    /// gone.
    private struct FilingFailed: LocalizedError {
        var errorDescription: String? { AddToTuneModel.failed }
    }
}
