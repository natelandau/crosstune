import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneDesign
import CrosstuneDiagnostics
import CrosstuneExport
import CrosstuneStore
import CrosstuneSync
import SwiftUI
import UniformTypeIdentifiers

#if os(macOS)
    import AppKit
#endif

/// Exports one or more recordings: says first which it leaves out, then prepares the rest,
/// fetching those the device does not hold, and hands the files to the share sheet on iPhone and
/// iPad. On the Mac one file goes to the share picker or a save panel, and several go into a
/// folder the musician picks. Held open while it prepares, so Cancel is the one way out and
/// nothing it abandons is handed off. `onDelivered` gets the line that says how many recordings
/// were left out, if any.
struct RecordingExportSheet: View {
    let onDelivered: (_ leftOut: String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var model: RecordingExportModel

    init(
        request: RecordingExportRequest, engine: SyncEngine?, analytics: AnalyticsClient,
        diagnostics: DiagnosticsClient,
        onDelivered: @escaping (_ leftOut: String?) -> Void = { _ in }
    ) {
        self.onDelivered = onDelivered
        _model = State(
            initialValue: RecordingExportModel(
                request: request, engine: engine, analytics: analytics, diagnostics: diagnostics))
    }

    var body: some View {
        content
            .interactiveDismissDisabled(model.isBusy)
            .task { model.open() }
            .onDisappear { model.abandonRun() }
    }

    private var title: String { model.request.title }

    /// The sheet's one button, when it has one.
    private struct Primary {
        let label: String
        let isEnabled: Bool
        let perform: @MainActor () -> Void
    }

    private var primary: Primary? {
        switch model.stage {
        case .notStarted(notice: .some):
            Primary(label: ImportCopy.continueAction, isEnabled: model.request.canContinue) { model.start() }
        case .failed:
            // A failed save or write keeps the files, so another try only asks where to put them.
            Primary(
                label: model.prepared == nil ? RecordingExportText.tryAgain : RecordingExportText.export,
                isEnabled: true, perform: model.retry)
        default: nil
        }
    }

    private func cancel() {
        model.cancel()
        dismiss()
    }

    private func end(_ end: RecordingExportModel.HandOffEnd?) {
        guard let end else { return }
        dismiss()
        if case .delivered(let leftOut) = end { onDelivered(leftOut) }
    }

    #if os(macOS)
        private var file: URL? { model.prepared?.files.first }

        /// Whether `delivery`'s save panel or folder picker shows.
        private func asking(_ delivery: RecordingExportRequest.Delivery) -> Binding<Bool> {
            Binding(
                get: { model.request.delivery == delivery && model.isAsking },
                set: { if !$0 { model.stopAsking() } })
        }

        private var content: some View {
            MacSheet(
                title: title, size: .fitted(.brief),
                // A write under way finishes or fails as a whole, so it cannot be cancelled.
                cancel: .cancel(TuneFormSheet.cancel, isEnabled: model.stage != .writing, action: cancel),
                primary: primary.map { primary in
                    .init(primary.label, isEnabled: primary.isEnabled, action: primary.perform)
                }
            ) {
                VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                    if let notice = model.notice {
                        Text(notice)
                            .font(MacStyle.body)
                            .foregroundStyle(Palette.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if model.isBusy {
                        ExportProgressView(text: model.progressText)
                    }
                    if let failure = model.failure {
                        FailureText(failure)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .coversShell(model.prepared != nil)
            .fileExporter(
                isPresented: asking(.saveFile), item: file.map { ExportedFile(url: $0, type: .audiovisualContent) },
                contentTypes: [.audiovisualContent], defaultFilename: file?.lastPathComponent,
                onCompletion: { result in
                    switch result {
                    case .success: end(model.finishHandOff(delivered: true))
                    case .failure(let error): model.saveFailed(error)
                    }
                },
                onCancellation: { end(model.finishHandOff(delivered: false)) }
            )
            .background {
                FolderPicker(isPresented: asking(.saveIntoFolder)) { folder in
                    Task { end(await model.write(into: folder)) }
                }
            }
            .sharePicker(model.request.delivery == .share ? file : nil) { [weak model] chosen in
                defer { dismiss() }
                guard chosen else {
                    model?.finishHandOff(delivered: false)
                    return nil
                }
                // A chosen service reads the file after the sheet has gone, so it takes the file.
                return model?.detachHandOff()
            }
            .shellSheet()
        }
    #else
        private var content: some View {
            NavigationStack {
                GroupedForm {
                    Section {
                        if let notice = model.notice {
                            Text(notice)
                        }
                        if model.isBusy {
                            ExportProgressView(text: model.progressText)
                        }
                    } footer: {
                        if let failure = model.failure {
                            Text(failure)
                                .foregroundStyle(Palette.danger)
                        }
                    }
                }
                .sheetActions(isShown: primary != nil) {
                    if let primary {
                        Button(primary.label, action: primary.perform)
                            .disabled(!primary.isEnabled)
                    }
                } secondary: {
                    EmptyView()
                }
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(TuneFormSheet.cancel, action: cancel)
                    }
                }
            }
            .coversShell(model.prepared != nil)
            .shareSheet(model.prepared?.files ?? []) { completed in end(model.finishHandOff(delivered: completed)) }
            .presentationDetents([.medium])
            .shellSheet()
        }
    #endif
}

#if os(macOS)
    /// Shows a folder picker as a sheet on this view's window while `isPresented` is true, then
    /// hands `onPick` the folder chosen, or nil.
    private struct FolderPicker: NSViewRepresentable {
        @Binding var isPresented: Bool
        let onPick: (URL?) -> Void

        final class Coordinator {
            var isShowing = false
        }

        func makeCoordinator() -> Coordinator {
            Coordinator()
        }

        func makeNSView(context: Context) -> PanelAnchorView {
            PanelAnchorView()
        }

        func updateNSView(_ view: PanelAnchorView, context: Context) {
            guard isPresented else { return view.withdraw() }
            let coordinator = context.coordinator
            guard !coordinator.isShowing else { return }
            view.request { [$isPresented, onPick] anchor in
                guard let window = anchor.window else { return }
                coordinator.isShowing = true
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.canCreateDirectories = true
                panel.allowsMultipleSelection = false
                panel.prompt = ExportDataSheet.action
                panel.beginSheetModal(for: window) { response in
                    coordinator.isShowing = false
                    $isPresented.wrappedValue = false
                    onPick(response == .OK ? panel.url : nil)
                }
            }
        }
    }
#endif

/// The export sheet a screen shows: some of the musician's recordings, or everything the
/// account holds.
enum ExportSheetItem: Identifiable {
    case recordings(RecordingExportRequest)
    case everything

    var id: String {
        switch self {
        case .recordings(let request): request.id.uuidString
        case .everything: "everything"
        }
    }
}

extension View {
    /// Shows `item`'s export sheet over the view, exporting through the environment's store,
    /// sync engine, and session.
    func exportSheet(_ item: Binding<ExportSheetItem?>) -> some View {
        modifier(ExportSheets(item: item))
    }
}

private struct ExportSheets: ViewModifier {
    @Binding var item: ExportSheetItem?

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(\.diagnostics) private var diagnostics
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(AccountSession.self) private var session: AccountSession?

    func body(content: Content) -> some View {
        content
            .sheet(item: $item) { shown in
                switch shown {
                case .recordings(let request):
                    RecordingExportSheet(
                        request: request, engine: engine, analytics: analytics, diagnostics: diagnostics)
                case .everything:
                    ExportDataSheet(
                        store: store, engine: engine, isOffline: { [session] in session?.isOffline ?? true },
                        analytics: analytics, diagnostics: diagnostics)
                }
            }
    }
}
