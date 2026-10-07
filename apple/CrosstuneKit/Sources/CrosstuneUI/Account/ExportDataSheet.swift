import CoreTransferable
import CrosstuneAnalytics
import CrosstuneStore
import SwiftUI
import UniformTypeIdentifiers

/// Zips the tunes, lists, and every recording and scan this device holds, then hands the zip to the
/// share sheet on iPhone or a save panel on the Mac. Held open while an export runs, so Cancel
/// is the one way out and nothing it abandons is handed off.
public struct ExportDataSheet: View {
    public static let title = "Export data"
    public static let action = "Export"
    public static let completeNote =
        "Exports your tunes and lists as spreadsheets, with every recording and scan, in one zip file."

    public static func note(onDevice: Int, total: Int) -> String {
        guard onDevice < total else { return completeNote }
        return
            "\(onDevice) of \(total) \(total == 1 ? "recording is" : "recordings are") on this device. Only those are exported. To include every recording, turn on \(SettingsModel.keepOffline) and wait for the downloads to finish."
    }

    public static func progress(done: Int, total: Int) -> String {
        "Preparing file \(done) of \(total)"
    }

    @Environment(\.dismiss) private var dismiss
    @State private var model: ExportDataModel
    #if os(macOS)
        @State private var panelShown = false
    #endif

    public init(store: CrosstuneStore?, analytics: AnalyticsClient) {
        _model = State(initialValue: ExportDataModel(exporter: store.map(Exporter.live), analytics: analytics))
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let note = model.note {
                        Text(note)
                    }
                    if let progress = model.progress, let text = model.progressText {
                        ProgressView(value: Double(progress.done), total: Double(progress.total)) {
                            Text(text)
                        }
                    }
                } footer: {
                    if let failure = model.failure {
                        Text(failure)
                            .foregroundStyle(.red)
                    }
                }
                Section {
                    Button(Self.action) { model.start() }
                        .disabled(!model.canStart)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(Self.title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(TuneFormSheet.cancel) {
                        model.cancel()
                        dismiss()
                    }
                }
            }
        }
        #if os(iOS)
            .coversShell(model.exported != nil)
            .shareSheet(model.exported) { finishHandOff() }
        #else
            .coversShell(model.exported != nil)
            .fileExporter(
                isPresented: $panelShown, item: model.exported.map(ExportFile.init), contentTypes: [.zip],
                defaultFilename: model.exported?.lastPathComponent,
                onCompletion: { _ in finishHandOff() }, onCancellation: { finishHandOff() }
            )
            // The panel shows once per zip. Its closing clears only `panelShown`; the zip waits
            // for the completion handlers, since the save may still be copying it.
            .onChange(of: model.exported) { panelShown = model.exported != nil }
        #endif
        #if os(iOS)
            .presentationDetents([.large])
            .shellSheet()
        #else
            .macSheetFrame(.form(minHeight: 320))
            .shellSheet()
        #endif
        .interactiveDismissDisabled(model.isRunning)
        .task { await model.followCounts() }
        .onDisappear { model.abandonRun() }
    }

    private func finishHandOff() {
        guard model.exported != nil else { return }
        model.finishHandOff()
        dismiss()
    }
}

/// The zip as a file a save panel copies from where it already is.
private struct ExportFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .zip) { SentTransferredFile($0.url) }
    }
}

#if os(iOS)
    extension View {
        /// Presents the system share sheet for `url` while it is non-nil, and calls `onDismiss`
        /// once it closes, whether or not anything was shared.
        func shareSheet(_ url: URL?, onDismiss: @escaping @MainActor () -> Void) -> some View {
            background(SharePresenter(url: url, onDismiss: onDismiss))
        }
    }

    /// Presents `UIActivityViewController` from inside the current presentation, since SwiftUI
    /// has no share sheet that reports when it closes.
    private struct SharePresenter: UIViewControllerRepresentable {
        let url: URL?
        let onDismiss: @MainActor () -> Void

        func makeUIViewController(context: Context) -> Controller {
            Controller(onDismiss: onDismiss)
        }

        func updateUIViewController(_ controller: Controller, context: Context) {
            controller.onDismiss = onDismiss
            controller.show(url)
        }

        final class Controller: UIViewController {
            var onDismiss: @MainActor () -> Void
            private var shown: URL?

            init(onDismiss: @escaping @MainActor () -> Void) {
                self.onDismiss = onDismiss
                super.init(nibName: nil, bundle: nil)
            }

            @available(*, unavailable)
            required init?(coder: NSCoder) {
                fatalError("init(coder:) is not supported")
            }

            func show(_ url: URL?) {
                guard let url, url != shown else { return }
                shown = url
                let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                // iPad shows the share sheet as a popover, which needs an anchor.
                if let popover = activity.popoverPresentationController {
                    popover.sourceView = view
                    popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
                    popover.permittedArrowDirections = []
                }
                // Held strongly so the zip is still cleaned up if this controller goes first.
                let onDismiss = onDismiss
                activity.completionWithItemsHandler = { [weak self, weak activity] type, completed, _, _ in
                    let finish = {
                        self?.shown = nil
                        onDismiss()
                    }
                    if completed || type == nil || Self.isGone(activity) { return finish() }
                    // Backing out of one service, as from the Files picker, leaves the share
                    // sheet up for another, but the sheet may also be on its way out, so look
                    // again once this turn's dismissal has started.
                    DispatchQueue.main.async {
                        if Self.isGone(activity) { finish() }
                    }
                }
                present(activity, animated: true)
            }

            private static func isGone(_ activity: UIViewController?) -> Bool {
                guard let activity else { return true }
                return activity.presentingViewController == nil || activity.isBeingDismissed
            }
        }
    }
#endif
