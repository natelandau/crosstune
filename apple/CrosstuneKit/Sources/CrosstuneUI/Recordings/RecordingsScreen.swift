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
        #if os(iOS)
            .navigationTitle(Destination.recordings.title)
        #endif
    }
}

/// How much of the account's audio quota is spent.
struct StorageSummary: View {
    let storage: StorageFigures

    @Environment(\.spacing) private var spacing

    var body: some View {
        let text = RecordingText.storageUsed(storage)
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

/// A group's title over its recordings, as a plain heading with no card behind it.
struct RecordingsGroupHeading: View {
    let title: String

    var body: some View {
        #if os(macOS)
            Text(title)
                .font(MacStyle.sectionHeading)
                .foregroundStyle(.primary)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)
        #else
            Text(title)
                .font(PageStyle.sectionHeading)
                .foregroundStyle(.primary)
                .textCase(nil)
                .accessibilityAddTraits(.isHeader)
        #endif
    }
}

private struct RecordingsContent: View {
    @Bindable var model: RecordingsModel

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.detailTune) private var detailTune
    @Environment(\.playerWindow) private var window
    @Environment(\.spacing) private var spacing
    @Environment(\.openURL) private var openURL
    @Environment(\.openSheets) private var openSheets
    @AppStorage(RecordingSortChoice.storageKey) private var sort = RecordingSortChoice.default
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

    /// Whether the empty state for an account with no recordings shows over the list.
    private var hasNoRecordingsAtAll: Bool {
        model.hasNoRecordings && model.unfinished.isEmpty
    }

    /// The tune form opened from the add to tune sheet, and the recording it files once saved.
    private struct CreatingTune: Identifiable {
        let recordingID: String
        let target: TuneFormTarget

        var id: TuneFormTarget { target }
    }

    var body: some View {
        let arrangement = model.arrangement(sort)
        let sheetsOpen = openSheets?.isCovered == true
        List(selection: openRecording) {
            #if os(macOS)
                ColumnTitle(Destination.recordings.title)
                    .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
            #endif
            #if os(macOS)
                if model.filterCount > 0 {
                    RecordingsFilterBar(choice: model.choice) {
                        Task { await model.resetSource() }
                    }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .selectionDisabled()
                }
                if let storage = model.storage {
                    StorageSummary(storage: storage)
                        .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 8, trailing: 8))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .selectionDisabled()
                }
            #else
                if model.showsFilters {
                    RecordingsFilterRow(
                        choice: model.choice, count: model.filterCount, onFilters: { showsFilters = true },
                        onReset: { Task { await model.resetSource() } }
                    )
                    .listRowInsets(
                        EdgeInsets(top: spacing.stackGap, leading: 16, bottom: spacing.stackGap, trailing: 16)
                    )
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                }
            #endif
            #if os(macOS)
                if model.showsUnfinished { unfinishedSection }
                if let arrangement {
                    if arrangement.isEmpty && !model.hasNoRecordings { countSection(arrangement) }
                    if !arrangement.unfiled.isEmpty { unfiledSection(arrangement) }
                    filedSection(
                        arrangement.filed, listHeader: arrangement.unfiled.isEmpty ? arrangement : nil)
                }
            #else
                let order = RecordingArrangement.sectionOrder(
                    hasUnfinished: model.showsUnfinished, hasUnfiled: arrangement?.unfiled.isEmpty == false,
                    tuneCount: arrangement.map(Self.filedCount) ?? 0,
                    narrowedToNothing: arrangement.map { $0.isEmpty && !model.hasNoRecordings } ?? false,
                    showsEmptyState: hasNoRecordingsAtAll || model.showsNothingMatches(arrangement))
                ForEach(order, id: \.self) { section in
                    switch section {
                    case .unfinished: unfinishedSection
                    case .count: arrangement.map(countSection)
                    case .unfiled: arrangement.map(unfiledSection)
                    case .tunes:
                        arrangement.map { filedSection($0.filed, listHeader: $0.unfiled.isEmpty ? $0 : nil) }
                    case .storage:
                        if let storage = model.storage {
                            StorageSummary(storage: storage)
                                .listRowInsets(
                                    EdgeInsets(
                                        top: spacing.stackGap, leading: 16, bottom: spacing.stackGap, trailing: 16)
                                )
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                        }
                    }
                }
            #endif
        }
        #if os(iOS)
            .listStyle(.plain)
        #endif
        .overlay {
            Group {
                if hasNoRecordingsAtAll {
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
        #if os(macOS)
            // Inside the pane bar, so the outline frames the rows and never crosses the search.
            .overlay {
                if dropTargeted { DropOverlay() }
            }
        #endif
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
        #if os(macOS)
            // Plain headings over the groups rather than inset cards.
            .listStyle(.plain)
            // The screen's own actions share its search's bar, as the catalog's do.
            .paneBar {
                searchField
            } _: {
                uploadButton.labelStyle(.iconOnly)
            }
            .columnTitled(Destination.recordings.title)
        #else
            .searchable(
                text: $model.query, placement: .navigationBarDrawer(displayMode: .always),
                prompt: RecordingsListText.search
            )
            .searchFocused($searchFocused)
            .onSubmit(of: .search) { searchFocused = false }
            .textInputAutocapitalization(.never)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(RecordingImport.upload, systemImage: "plus") { importing = true }
                    .accessibilityLabel(RecordingImport.uploadAudio)
                }
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
            isPresented: $deleting.isPresent(),
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
            isPresented: $discarding.isPresent(),
            titleVisibility: .visible, presenting: discarding
        ) { capture in
            Button(RecordingRowActions.delete, role: .destructive) {
                Task { await model.discard(capture) }
            }
        } message: { _ in
            Text(RecordingsModel.deleteUnsyncedNote)
        }
    }

    /// How many tune groups or flat filed rows the filed section shows.
    private static func filedCount(_ arrangement: RecordingArrangement) -> Int {
        switch arrangement.filed {
        case .flat(let views): views.count
        case .byTune(let tunes): tunes.count
        }
    }

    private var unfinishedSection: some View {
        Section {
            ForEach(model.unfinished, id: \.id) { capture in
                // A capture shares its recording's id, so it must never stand in for that row.
                unfinishedRow(capture)
                    .selectionDisabled()
            }
        } header: {
            heading(RecordingsScreen.unfinishedHeader)
        }
    }

    private func countSection(_ arrangement: RecordingArrangement) -> some View {
        Section {
        } header: {
            ListHeader<RecordingSort>(count: model.countLabel(arrangement), choice: nil)
                .textCase(nil)
                .headerInsets()
        }
    }

    private func unfiledSection(_ arrangement: RecordingArrangement) -> some View {
        Section {
            ForEach(arrangement.unfiled) { view in
                row(view)
            }
        } header: {
            sectionHeader(RecordingsListText.unfiled, listHeader: arrangement)
        }
    }

    /// The filed recordings in one section: flat, each row naming its tune, or under a line per
    /// tune.
    @ViewBuilder private func filedSection(
        _ filed: FiledRecordings, listHeader arrangement: RecordingArrangement?
    ) -> some View {
        switch filed {
        case .flat(let views):
            if !views.isEmpty {
                Section {
                    ForEach(views) { view in
                        row(view, opensTune: true)
                    }
                } header: {
                    sectionHeader(RecordingsListText.filed, listHeader: arrangement)
                }
            }
        case .byTune(let tunes):
            if !tunes.isEmpty {
                Section {
                    ForEach(tunes) { tune in
                        tuneLabel(tune)
                        ForEach(tune.views) { view in
                            row(view)
                        }
                    }
                } header: {
                    sectionHeader(RecordingsListText.filed, listHeader: arrangement)
                }
            }
        }
    }

    /// A section's title, under the list header when the section leads the recordings. A row of
    /// its own between two sections would stand apart from both, so the count and sort ride on
    /// the first section's header, directly above the rows they describe.
    @ViewBuilder private func sectionHeader(_ title: String, listHeader arrangement: RecordingArrangement?)
        -> some View
    {
        if let arrangement {
            VStack(alignment: .leading, spacing: 0) {
                ListHeader(count: model.countLabel(arrangement), choice: $sort)
                    .textCase(nil)
                RecordingsGroupHeading(title: title)
            }
            .headerInsets()
        } else {
            heading(title)
        }
    }

    private func heading(_ title: String) -> some View {
        RecordingsGroupHeading(title: title)
            .headerInsets()
    }

    #if os(macOS)
        private var searchField: some View {
            FilterSearchField(
                prompt: RecordingsListText.search, query: $model.query, isFocused: $searchFocused,
                filterCount: model.showsFilters ? model.filterCount : nil,
                onSubmit: { searchFocused = false }, onFilters: { showsFilters = true })
        }

        private var uploadButton: some View {
            Button(RecordingImport.upload, systemImage: "square.and.arrow.down") { importing = true }
                .help(RecordingImport.uploadAudio)
                .accessibilityLabel(RecordingImport.uploadAudio)
        }
    #endif

    /// The recording whose practice view the Mac detail column shows, as the list's selection,
    /// so its row reads as the open one and the arrow keys open its neighbors. Nil elsewhere.
    private var openRecording: Binding<String?>? {
        #if os(macOS)
            guard let player else { return nil }
            return Binding<String?> {
                guard player.showsExpanded(in: window), let item = player.item, item.kind == .recording else {
                    return nil
                }
                return item.id
            } set: { id in
                guard let id, let view = model.view(id) else { return }
                player.open(.recording(view.recording, tuneTitle: view.tuneTitle), in: window, playing: false)
            }
        #else
            nil
        #endif
    }

    /// A recording's row. A filed one names its tune in a tune line when `opensTune`, and
    /// otherwise sits under a line naming it; either way its title never falls back to the tune.
    private func row(_ view: RecordingView, opensTune: Bool = false) -> some View {
        let open = view.tuneID.map { tuneID in { openTune(tuneID) } }
        #if os(macOS)
            let opensScreen = true
        #else
            let opensScreen = false
        #endif
        return RecordingItem(
            view: view, tuneNamedAbove: view.tuneID != nil, storage: model.storage, sort: sort.sort,
            onOpenTune: opensTune ? open : nil, opensScreen: opensScreen
        ) { kind in
            retry(view.id, kind)
        }
        .newTakeHighlight(view.id)
        .mediaRowInsets()
        .tag(view.id)
        // A row with no audio here downloads or retries on a click, so selecting it, or arrowing
        // past it, must not open its practice view and fetch it.
        .selectionDisabled(!RecordingText.holdsAudio(view.file) && player?.holds(.recording, id: view.id) != true)
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
            #if os(macOS)
                .font(MacStyle.secondary.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(minHeight: MacStyle.smallControlHeight)
            #else
                .font(.footnote.bold())
                .foregroundStyle(.secondary)
                .frame(minHeight: minimumTapTarget)
            #endif
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .matchedTransitionSource(id: tune.tuneID, in: zoom)
        .accessibilityAddTraits(.isHeader)
        .selectionDisabled()
        #if os(macOS)
            .mediaRowInsets()
        #endif
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
        .mediaRowInsets()
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

extension View {
    /// A section header's place: on the Mac at the column's row edges; on iOS with no top
    /// padding, since the space between sections already sets the groups apart.
    fileprivate func headerInsets() -> some View {
        #if os(macOS)
            padding(.horizontal, 8)
        #else
            listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 4, trailing: 16))
        #endif
    }

    /// A media row's place in a list: on the Mac at the column's tune row edges, with no
    /// separator, as the tune rows sit.
    fileprivate func mediaRowInsets() -> some View {
        #if os(macOS)
            listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
                .listRowSeparator(.hidden)
        #else
            scaledRowInsets()
        #endif
    }
}
