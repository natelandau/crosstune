import CrosstuneAnalytics
import CrosstuneDesign
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
                    .screenView(.recordings)
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

/// A group's title over its recordings, as a plain heading with no card behind it.
struct RecordingsGroupHeading: View {
    let title: String

    var body: some View {
        Text(title)
            .font(PageStyle.sectionHeading)
            #if os(macOS)
                .foregroundStyle(Palette.textPrimary)
            #else
                .foregroundStyle(.textPrimary)
            #endif
            .textCase(nil)
            .padding(.top, PageStyle.groupHeadingTop)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct RecordingsContent: View {
    @Bindable var model: RecordingsModel

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(AddedTuneUndo.self) private var addedTune: AddedTuneUndo?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.detailTune) private var detailTune
    @Environment(\.playerWindow) private var window
    @Environment(\.spacing) private var spacing
    @Environment(\.openURL) private var openURL
    @Environment(\.openSheets) private var openSheets
    @Environment(\.plan) private var planModel: PlanModel?
    @Environment(\.premium) private var premium
    @AppStorage(RecordingSortChoice.storageKey) private var sort = RecordingSortChoice.default
    @FocusState private var searchFocused: Bool
    private var plan: Plan { planModel?.plan ?? .unknown }
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
    /// A tune the add to tune sheet asked to start, with the recording to file under it, made
    /// once that sheet has gone.
    @State private var creating: (recordingID: String, title: String)?
    @State private var deleting: RecordingView?
    @State private var discarding: RecordingFile?
    @Namespace private var zoom

    /// Whether the empty state for an account with no recordings shows over the list.
    private var hasNoRecordingsAtAll: Bool {
        model.hasNoRecordings && model.unfinished.isEmpty
    }

    var body: some View {
        let arrangement = model.arrangement(sort)
        let sheetsOpen = openSheets?.isCovered == true
        List(selection: openRecording) {
            #if os(macOS)
                // Title, then the set source, then one header line, then the groups, as the
                // catalog's column runs; the storage meter sits in a bar at the column's foot.
                ColumnTitle(Destination.recordings.title)
                    .columnTitleBaseline(.insetList)
                    .listRowInsets(MacStyle.columnRowInsets())
                    .plainListRow()
                if model.filterCount > 0 {
                    RecordingsFilterBar(choice: model.choice) {
                        Task { await model.resetSource() }
                    }
                    .listRowInsets(MacStyle.columnRowInsets(top: 8, bottom: 2))
                    .plainListRow()
                }
                if let arrangement, !model.hasNoRecordings {
                    ListHeader(count: model.countLabel(arrangement), choice: arrangement.isEmpty ? nil : $sort)
                        .listRowInsets(MacStyle.columnRowInsets())
                        .plainListRow()
                }
            #else
                if model.filterCount > 0 {
                    RecordingsFilterRow(choice: model.choice) { Task { await model.resetSource() } }
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
                    if !arrangement.unfiled.isEmpty { unfiledSection(arrangement) }
                    filedSection(arrangement.filed, listHeader: nil)
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
                        if let storage = model.storage(plan: plan) {
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
            .pageBackground()
            .accentSelectionTint()
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
                    .font(.platform(.footnote))
                    .foregroundStyle(Palette.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, spacing.stackGap)
            }
        }
        #if os(macOS)
            .macColumnList()
            .safeAreaBar(edge: .bottom, spacing: 0) {
                if let storage = model.storage(plan: plan) {
                    StorageBar(storage: storage)
                }
            }
            // A row says Stop recording to play once, under its group's heading.
            .environment(\.mediaNoticeInHeading, true)
            // The screen's own actions share its search's bar, as the catalog's do.
            .paneBar(slot: PaneBarLayout.slotWidth(icons: 1)) {
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
                    Button(RecordingImport.upload, systemImage: "plus") { upload() }
                    .accessibilityLabel(RecordingImport.uploadAudio)
                }
                if model.showsFilters {
                    ToolbarItem(placement: .primaryAction) {
                        FiltersButton(setCount: model.filterCount, iconOnly: true) { showsFilters = true }
                    }
                }
                AccountToolbarItem()
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
                guard !files.isEmpty, premium?.gate(.recordings, from: .upload) ?? true else { return false }
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
            AddToTuneSheet(recordingID: view.id) { title in creating = (view.id, title) }
        }
        #if DEBUG
            .opensForSample(.recordingsFilters) { showsFilters = true }
            .opensForSample(.recordingsSetFilters) { Task { await model.setChoice(RecordingText.ownOrigin) } }
            .opensForSample(.editRecording, when: model.view(SampleScreen.editedRecordingID) != nil) {
                editing = model.view(SampleScreen.editedRecordingID)
            }
            .opensForSample(.editLocation, when: model.view(SampleScreen.editedRecordingID) != nil) {
                editing = model.view(SampleScreen.editedRecordingID)
            }
            .opensForSample(.addToTune, when: model.view(SampleScreen.unfiledRecordingID) != nil) {
                filing = model.view(SampleScreen.unfiledRecordingID)
            }
        #endif
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
        .focusedSceneValue(
            \.recordingsSort, MenuCommandAvailability.sort(isShown: isShown, sheetsOpen: sheetsOpen) ? $sort : nil
        )
        .focusedSceneValue(
            \.findAction,
            MenuCommandAvailability.find(isShown: isShown, sheetsOpen: sheetsOpen)
                ? MenuAction { searchFocused = true } : nil
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

    /// A group of rows under its heading. On the Mac the heading is a row of its own, so the
    /// space above it is the list's row spacing and not the wider gap the system sets between
    /// sections.
    @ViewBuilder private func recordingGroup(
        @ViewBuilder rows: () -> some View, @ViewBuilder header: () -> some View
    ) -> some View {
        #if os(macOS)
            header()
                .listRowInsets(MacStyle.columnRowInsets(top: 12, bottom: 2))
                .plainListRow()
            rows()
        #else
            Section {
                rows()
            } header: {
                header()
            }
        #endif
    }

    private var unfinishedSection: some View {
        recordingGroup {
            ForEach(model.unfinished, id: \.id) { capture in
                // A capture shares its recording's id, so it must never replace that row.
                unfinishedRow(capture)
                    .selectionDisabled()
            }
        } header: {
            heading(RecordingsScreen.unfinishedHeader)
        }
    }

    #if os(iOS)
        private func countSection(_ arrangement: RecordingArrangement) -> some View {
            Section {
            } header: {
                ListHeader<RecordingSort>(count: model.countLabel(arrangement), choice: nil)
                    .textCase(nil)
                    .headerInsets()
            }
        }
    #endif

    private func unfiledSection(_ arrangement: RecordingArrangement) -> some View {
        recordingGroup {
            ForEach(arrangement.unfiled) { view in
                row(view)
            }
        } header: {
            sectionHeader(
                RecordingsListText.unfiled, listHeader: macListHeader(arrangement), rows: arrangement.unfiled)
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
                recordingGroup {
                    ForEach(views) { view in
                        row(view, opensTune: true)
                    }
                } header: {
                    sectionHeader(RecordingsListText.filed, listHeader: arrangement, rows: views)
                }
            }
        case .byTune(let tunes):
            if !tunes.isEmpty {
                recordingGroup {
                    ForEach(tunes) { tune in
                        tuneLabel(tune)
                        ForEach(tune.views) { view in
                            row(view)
                        }
                    }
                } header: {
                    sectionHeader(
                        RecordingsListText.filed, listHeader: arrangement, rows: tunes.flatMap(\.views))
                }
            }
        }
    }

    /// A section's title, under the list header when the section leads the recordings. A row of
    /// its own between two sections would sit apart from both, so the count and sort ride on
    /// the first section's header, directly above the rows they describe.
    @ViewBuilder private func sectionHeader(
        _ title: String, listHeader arrangement: RecordingArrangement?, rows: [RecordingView]
    ) -> some View {
        if let arrangement {
            VStack(alignment: .leading, spacing: 0) {
                ListHeader(count: model.countLabel(arrangement), choice: $sort)
                    .textCase(nil)
                RecordingsGroupHeading(title: title)
            }
            .headerInsets()
        } else {
            heading(title, rows: rows)
        }
    }

    /// A group's heading; on the Mac it says Stop recording to play once for `rows`, when one of
    /// them would.
    private func heading(_ title: String, rows: [RecordingView] = []) -> some View {
        #if os(macOS)
            VStack(alignment: .leading, spacing: 2) {
                RecordingsGroupHeading(title: title)
                if blocksPlay(rows) {
                    Text(MediaText.stopRecordingToPlay)
                        .font(MacStyle.secondary)
                        .foregroundStyle(Palette.textSecondary)
                }
            }
            .headerInsets()
        #else
            RecordingsGroupHeading(title: title)
                .headerInsets()
        #endif
    }

    /// Whether a recording under way disables one of `rows`' plays.
    private func blocksPlay(_ rows: [RecordingView]) -> Bool {
        guard recorders?.isCapturing == true else { return false }
        return rows.contains { view in
            RecordingRowContent.blocksPlay(
                view.recording, file: view.file, loaded: player?.holds(.recording, id: view.id) ?? false,
                downloading: transfers?.isDownloading(view.id) ?? false)
        }
    }

    /// The arrangement whose count and sort ride on a group's header: never on the Mac, where
    /// they have a line of their own under the title.
    private func macListHeader(_ arrangement: RecordingArrangement) -> RecordingArrangement? {
        #if os(macOS)
            nil
        #else
            arrangement
        #endif
    }

    #if os(macOS)
        private var searchField: some View {
            FilterSearchField(
                prompt: RecordingsListText.search, query: $model.query, isFocused: $searchFocused,
                filterCount: model.showsFilters ? model.filterCount : nil,
                onSubmit: { searchFocused = false }, onFilters: { showsFilters = true })
        }

        private var uploadButton: some View {
            Button(RecordingImport.upload, systemImage: "square.and.arrow.down") { upload() }
                .help(RecordingImport.uploadAudio)
                .accessibilityLabel(RecordingImport.uploadAudio)
        }
    #endif

    /// Opens the file picker, or the Plan sheet when the plan holds recordings back.
    private func upload() {
        importing = premium?.gate(.recordings, from: .upload) ?? true
    }

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
                // The row's own tap offers Premium instead.
                guard plan.recordingsPlay, let id, let view = model.view(id) else { return }
                player.open(
                    .recording(view.recording, tuneTitle: view.tuneTitle), in: window, playing: false,
                    source: .recordingsList)
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
            view: view, source: .recordingsList, tuneNamedAbove: view.tuneID != nil, storage: model.storage(plan: plan),
            sort: sort.sort,
            onOpenTune: opensTune ? open : nil, opensScreen: opensScreen
        ) { kind in
            retry(view.id, kind)
        }
        .newRecordingHighlight(view.id)
        .mediaRowInsets()
        .unselectedRowBackground(isSelected: openRecording?.wrappedValue == view.id)
        #if os(macOS)
            .macRowSelected(openRecording?.wrappedValue == view.id)
        #endif
        .tag(view.id)
        // A row with no audio here downloads or retries on a click, so selecting it, or arrowing
        // past it, must not open its practice view and fetch it. A plan that holds recordings
        // back sends the click to the Plan sheet.
        .selectionDisabled(
            !plan.recordingsPlay
                || (!RecordingText.holdsAudio(view.file) && player?.holds(.recording, id: view.id) != true)
        )
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
                    .contentMask()
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .imageScale(.small)
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
            }
            .font(PageStyle.groupLabel)
            .foregroundStyle(.textSecondary)
            .frame(minHeight: PageStyle.lineButtonHeight)
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
            detailTune.value = tuneID
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
            actionLabel: row.actionLabel, action: { discarding = capture }
        )
        .mediaRowInsets()
        .unselectedRowBackground(isSelected: false)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { discard.tint(Palette.dangerFillStrong) }
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

    /// Creates the tune the add to tune sheet asked for, files the recording under it, and opens
    /// it, once the sheet has gone so the page opens over a screen with no sheet left. A refused
    /// filing still opens the tune, with the refusal in the window's banner over it, since the
    /// tune's page covers this screen's own failure line on iPhone.
    private func openCreated() {
        guard let creating else { return }
        self.creating = nil
        Task {
            guard let created = await model.createTune(creating.title, filing: creating.recordingID) else { return }
            if created.filingError != nil { addedTune?.notify(AddToTuneModel.failed) }
            openTune(created.tuneID)
        }
    }
}

extension View {
    /// A section header's place: on the Mac where the inset list puts it; on iOS with no top
    /// padding, since the space between sections already sets the groups apart.
    fileprivate func headerInsets() -> some View {
        #if os(macOS)
            self
        #else
            listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 4, trailing: 16))
        #endif
    }

    /// A media row's place in a list: on the Mac at the column's tune row edges, with no
    /// separator, as the tune rows sit.
    fileprivate func mediaRowInsets() -> some View {
        #if os(macOS)
            listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                .listRowSeparator(.hidden)
        #else
            scaledRowInsets()
        #endif
    }
}
