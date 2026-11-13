import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneDesign
import CrosstuneDiagnostics
import CrosstuneExport
import CrosstuneStore
import CrosstuneSync
import SwiftUI

extension View {
    /// Gives the Recordings screen its selection mode, on the same parts as the catalog's: the
    /// toolbar or bar that counts and acts on the selected recordings, the export sheet, the tune
    /// picker, the delete question, and the undo banner. `rows` are the selectable recordings in
    /// screen order, across the Unfiled section and every tune's, each tagged by its id, which
    /// `visibleIDs` lists in the same order.
    func recordingSelectionMode(
        _ selection: Binding<TuneSelection>, rows: [RecordingView], visibleIDs: [String],
        focusedRow: AccessibilityFocusState<String?>.Binding
    ) -> some View {
        modifier(
            RecordingSelectionMode(selection: selection, rows: rows, visibleIDs: visibleIDs, focusedRow: focusedRow))
    }
}

private struct RecordingSelectionMode: ViewModifier {
    @Binding var selection: TuneSelection
    let rows: [RecordingView]
    let visibleIDs: [String]
    let focusedRow: AccessibilityFocusState<String?>.Binding

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(\.diagnostics) private var diagnostics
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(AccountSession.self) private var session: AccountSession?
    @State private var bulk: RecordingBulkActions?
    @State private var exporting: RecordingExportRequest?
    @State private var linking: SelectedRows<RecordingView>?
    @State private var deleting: RecordingBulkDeleteQuestion?

    private var selected: [RecordingView] { selection.selected(in: rows) { $0.id } }

    func body(content: Content) -> some View {
        content
            .selectionFrame(
                $selection, visibleIDs: visibleIDs, title: RecordingsListText.recordings, runner: $bulk,
                focusedRow: focusedRow, actions: actions
            )
            .sheet(item: $exporting) { request in
                RecordingExportSheet(
                    request: request, engine: engine, analytics: analytics, diagnostics: diagnostics
                ) { leftOut in
                    selection.exit()
                    if let leftOut { bulk?.undoBannerItem = UndoBannerItem(message: leftOut) }
                }
            }
            .sheet(item: $linking) { sheet in
                if let bulk {
                    RecordingsLinkSheet(views: sheet.rows, bulk: bulk) { selection.exit() }
                }
            }
            #if os(macOS)
                .confirmsSelectionDelete($deleting, button: RecordingRowActions.delete, delete: delete)
            #endif
    }

    #if os(iOS)
        @ViewBuilder private func actions(_ bulk: RecordingBulkActions) -> some View {
            let isDisabled = selection.ids.isEmpty || bulk.isPending
            let deleteDisabledReason = RecordingBulkActions.deleteDisabledReason(selected)
            Button(action: export) {
                SelectionActionLabel(RecordingExportText.share, systemImage: "square.and.arrow.up")
            }
            .buttonStyle(.selectionAction)
            .disabled(isDisabled)
            Button(action: link) {
                SelectionActionLabel(RecordingsListText.linkToTune, systemImage: Self.linkSystemImage)
            }
            .buttonStyle(.selectionAction)
            .disabled(isDisabled)
            Button(role: .destructive) {
                askDelete(bulk)
            } label: {
                SelectionActionLabel(RecordingRowActions.delete, systemImage: "trash")
            }
            .buttonStyle(.selectionAction)
            .disabled(isDisabled || deleteDisabledReason != nil)
            // VoiceOver reads the reason, which the bar has no room to show.
            .accessibilityHint(deleteDisabledReason ?? "", isEnabled: deleteDisabledReason != nil)
            // On Delete, so the question points at it.
            .confirmsSelectionDelete($deleting, button: RecordingRowActions.delete, delete: delete)
        }
    #else
        private func actions(_ bulk: RecordingBulkActions) -> [MacSelectionMenuItem] {
            [
                MacSelectionMenuItem(
                    label: RecordingExportText.export, systemImage: "square.and.arrow.down", action: export),
                MacSelectionMenuItem(
                    label: "\(RecordingsListText.linkToTune)…", systemImage: Self.linkSystemImage, action: link),
                MacSelectionMenuItem(
                    label: RecordingsListText.delete(selection.ids.count), systemImage: "trash", isDestructive: true,
                    disabledReason: RecordingBulkActions.deleteDisabledReason(selected), startsGroup: true
                ) { askDelete(bulk) },
            ]
        }
    #endif

    private static let linkSystemImage = "music.note.list"

    private func askDelete(_ bulk: RecordingBulkActions) {
        let views = selected
        guard RecordingBulkActions.deleteDisabledReason(views) == nil else { return }
        Task { deleting = await bulk.deleteQuestion(views) }
    }

    /// Exports the selected recordings, each as it can be exported at this moment.
    private func export() {
        let items = selected.map {
            RecordingExportItem($0, readiness: ExportReadiness($0, store: store, engine: engine, session: session))
        }
        guard !items.isEmpty else { return }
        #if os(macOS)
            let delivery = RecordingExportRequest.Delivery.saveIntoFolder
        #else
            let delivery = RecordingExportRequest.Delivery.share
        #endif
        exporting = RecordingExportRequest(
            items: items, delivery: delivery, title: RecordingsListText.recordings(items.count))
    }

    private func link() {
        let views = selected
        guard !views.isEmpty else { return }
        linking = SelectedRows(rows: views)
    }

    private func delete(_ question: RecordingBulkDeleteQuestion) async {
        guard let bulk else { return }
        // The player lets go of the audio before its file goes.
        if question.deleting.contains(where: { player?.holds(.recording, id: $0.id) == true }) { player?.close() }
        if await bulk.delete(question) { selection.exit() }
    }
}

/// The tune picker for Link to tune: a pick links every selected recording to that tune and
/// closes; a typed title makes the tune first.
private struct RecordingsLinkSheet: View {
    let views: [RecordingView]
    let bulk: RecordingBulkActions
    let onLinked: () -> Void

    @Environment(\.store) private var store
    @State private var picker: RecordingTunePickerModel?

    var body: some View {
        TunePicker(title: RecordingsListText.linkToTune, selection: .one, model: picker)
            .task { await openPicker() }
            .shellSheet()
    }

    private func openPicker() async {
        guard picker == nil, let store else { return }
        let opened = RecordingTunePickerModel(
            store: store, chosenID: nil,
            onPick: { tune in
                if await bulk.link(views, to: tune.tune.id, tuneTitle: tune.tune.title) { onLinked() }
            },
            onCreate: { title in
                if await bulk.linkToNewTune(views, title: title) { onLinked() }
            })
        // Shown before the read, so the search field is in place as the sheet opens.
        picker = opened
        try? await opened.load()
    }
}
