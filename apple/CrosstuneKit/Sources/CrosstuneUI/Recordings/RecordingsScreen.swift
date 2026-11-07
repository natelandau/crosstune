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

extension RecordingsScreen {
    /// Opens the page of the recording a Mac click or arrow key selected, leaving playback as it
    /// is. Every listed recording opens, whether or not it can play.
    static func openSelected(_ id: String?, isListed: (String) -> Bool, open: RecordingPageOpener?) {
        guard let id, isListed(id) else { return }
        open?(id, source: .recordingsList)
    }

    #if os(macOS)
        /// Opens the selected recording's page unless a pointer press made the selection. A click
        /// on a row lands on the row's own button, which opens the page, or on its slot's, which
        /// never does, so the list's selection opens only for the arrow keys. `cause` is the event
        /// the selection came from, nil when there is none.
        static func openSelected(
            _ id: String?, isListed: (String) -> Bool, open: RecordingPageOpener?, cause: NSEvent.EventType?
        ) {
            guard !(cause.map(isPointerPress) ?? false) else { return }
            openSelected(id, isListed: isListed, open: open)
        }

        private static func isPointerPress(_ type: NSEvent.EventType) -> Bool {
            switch type {
            case .leftMouseDown, .leftMouseUp, .leftMouseDragged, .rightMouseDown, .rightMouseUp, .otherMouseDown,
                .otherMouseUp:
                true
            default: false
            }
        }
    #endif
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
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.detailTune) private var detailTune
    @Environment(\.detailRecording) private var detailRecording
    @Environment(\.openRecordingPage) private var openRecordingPage
    @Environment(\.spacing) private var spacing
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
        #if DEBUG
            .opensForSample(.recordingsFilters) { showsFilters = true }
            .opensForSample(.recordingsSetFilters) { Task { await model.setChoice(RecordingText.ownOrigin) } }
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

    /// The recording whose page the detail column shows, as the list's selection, so its row reads
    /// as the open one and, on the Mac, the arrow keys open its neighbors. Nil on a phone, where the
    /// page replaces the list.
    private var openRecording: Binding<String?>? {
        #if os(macOS)
            guard player != nil else { return nil }
        #else
            guard detailRecording != nil else { return nil }
        #endif
        return Binding<String?> {
            detailRecording?.value
        } set: { id in
            #if os(macOS)
                RecordingsScreen.openSelected(
                    id, isListed: { model.view($0) != nil }, open: openRecordingPage,
                    cause: NSApp.currentEvent?.type)
            #else
                RecordingsScreen.openSelected(id, isListed: { model.view($0) != nil }, open: openRecordingPage)
            #endif
        }
    }

    /// The space above and below a media row on the Mac, which sits at the column's tune row edges.
    private static let macRowInset: CGFloat = 4

    /// A recording's row. A filed one names its tune in a tune line when `opensTune`, and
    /// otherwise sits under a line naming it; either way its title never falls back to the tune.
    private func row(_ view: RecordingView, opensTune: Bool = false) -> some View {
        let open = view.tuneID.map { tuneID in { openTune(tuneID) } }
        return RecordingItem(
            view: view, source: .recordingsList, tuneNamedAbove: view.tuneID != nil, storage: model.storage(plan: plan),
            uploadLimits: model.uploadLimits, sort: sort.sort, onOpenTune: opensTune ? open : nil
        ) { kind in
            retry(view.id, kind)
        }
        .newRecordingHighlight(view.id)
        #if os(macOS)
            // The space above and below the row is inside the row's open button rather than in
            // the list's row insets, so a click anywhere on the row but its slot opens the page,
            // and the list's selection never has to.
            .padding(.vertical, Self.macRowInset)
            .background {
                Button {
                    openRecordingPage?(view.id, source: .recordingsList)
                } label: {
                    Color.clear.contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHidden(true)
                // The row's own button takes the same press, so keyboard focus stops there alone.
                .focusable(false)
            }
            .listItemRow()
        #else
            .listItemRow(macVerticalInset: Self.macRowInset)
        #endif
        .unselectedRowBackground(isSelected: openRecording?.wrappedValue == view.id)
        #if os(macOS)
            .macRowSelected(openRecording?.wrappedValue == view.id)
        #endif
        .tag(view.id)
        .recordingRowActions(
            onDelete: { deleting = view }, deleteDisabledReason: RecordingScreenText.deleteDisabledReason(view))
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
            .listItemRow(macVerticalInset: Self.macRowInset)
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
        .listItemRow(macVerticalInset: Self.macRowInset)
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
}
