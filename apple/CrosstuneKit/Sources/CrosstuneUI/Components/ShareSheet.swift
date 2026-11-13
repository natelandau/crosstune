import SwiftUI

#if os(iOS)
    extension View {
        /// Presents the system share sheet for `url` while it is non-nil, and calls `onDismiss`
        /// once it closes, with whether a service took the file.
        func shareSheet(_ url: URL?, onDismiss: @escaping @MainActor (_ completed: Bool) -> Void) -> some View {
            shareSheet(url.map { [$0] } ?? [], onDismiss: onDismiss)
        }

        /// Presents the system share sheet with each of `urls` as its own item while there are
        /// any, and calls `onDismiss` once it closes, with whether a service took the files.
        func shareSheet(_ urls: [URL], onDismiss: @escaping @MainActor (_ completed: Bool) -> Void) -> some View {
            background { SharePresenter(urls: urls, onDismiss: onDismiss) }
        }
    }

    /// Presents `UIActivityViewController` from inside the current presentation, since SwiftUI
    /// has no share sheet that reports when it closes.
    private struct SharePresenter: UIViewControllerRepresentable {
        let urls: [URL]
        let onDismiss: @MainActor (Bool) -> Void

        func makeUIViewController(context: Context) -> Controller {
            Controller(onDismiss: onDismiss)
        }

        func updateUIViewController(_ controller: Controller, context: Context) {
            controller.onDismiss = onDismiss
            controller.show(urls)
        }

        final class Controller: UIViewController {
            var onDismiss: @MainActor (Bool) -> Void
            private var shown: [URL] = []

            init(onDismiss: @escaping @MainActor (Bool) -> Void) {
                self.onDismiss = onDismiss
                super.init(nibName: nil, bundle: nil)
            }

            @available(*, unavailable)
            required init?(coder: NSCoder) {
                fatalError("init(coder:) is not supported")
            }

            func show(_ urls: [URL]) {
                guard !urls.isEmpty, urls != shown else { return }
                shown = urls
                let activity = UIActivityViewController(activityItems: urls, applicationActivities: nil)
                // iPad shows the share sheet as a popover, which needs an anchor.
                if let popover = activity.popoverPresentationController {
                    popover.sourceView = view
                    popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
                    popover.permittedArrowDirections = []
                }
                // Held strongly so the shared files are still cleaned up if this controller goes first.
                let onDismiss = onDismiss
                activity.completionWithItemsHandler = { [weak self, weak activity] type, completed, _, _ in
                    let finish = {
                        self?.shown = []
                        onDismiss(completed)
                    }
                    if completed || type == nil || Self.isGone(activity) { return finish() }
                    // Backing out of one service, as from the Files picker, leaves the share
                    // sheet up for another, but the sheet may also be on its way out, so look
                    // again once this turn's dismissal has started.
                    Task { @MainActor in
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

#if os(macOS)
    import AppKit

    extension View {
        /// Shows the system share picker under this view for `url` once it is non-nil. Calls
        /// `onChoose` as the picker closes, with whether a service was chosen, and then what it
        /// returns once that service has finished with the file. That closure is kept until
        /// then, so whatever it captures outlives the view.
        func sharePicker(
            _ url: URL?, onChoose: @escaping @MainActor (_ chosen: Bool) -> (@MainActor () -> Void)?
        ) -> some View {
            background { SharePickerAnchor(url: url, onChoose: onChoose) }
        }
    }

    private struct SharePickerAnchor: NSViewRepresentable {
        let url: URL?
        let onChoose: ShareSession.OnChoose

        final class Coordinator {
            var shown: URL?
        }

        func makeCoordinator() -> Coordinator {
            Coordinator()
        }

        func makeNSView(context: Context) -> PanelAnchorView {
            PanelAnchorView()
        }

        func updateNSView(_ view: PanelAnchorView, context: Context) {
            let coordinator = context.coordinator
            guard let url, url != coordinator.shown else {
                if url == nil { coordinator.shown = nil }
                return
            }
            coordinator.shown = url
            view.request { [onChoose] anchor in
                ShareSession.show(url, from: anchor, onChoose: onChoose)
            }
        }
    }

    /// An empty view that shows an AppKit panel or picker for SwiftUI once it is in a window, since
    /// the panel attaches to the window or points at the view.
    final class PanelAnchorView: NSView {
        private var pending: (@MainActor (PanelAnchorView) -> Void)?

        /// Runs `show` now, or once this view is in a window, in place of a request not yet run.
        func request(_ show: @escaping @MainActor (PanelAnchorView) -> Void) {
            pending = show
            showPending()
        }

        /// Drops a request not yet run.
        func withdraw() {
            pending = nil
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            showPending()
        }

        private func showPending() {
            guard window != nil, let pending else { return }
            self.pending = nil
            pending(self)
        }
    }

    /// One share from the picker to the service the musician chose. The picker and the service
    /// hold their delegates weakly, so each session is kept in ``live`` until it ends.
    @MainActor
    private final class ShareSession: NSObject, @MainActor NSSharingServicePickerDelegate,
        @MainActor NSSharingServiceDelegate
    {
        typealias OnChoose = @MainActor (_ chosen: Bool) -> (@MainActor () -> Void)?

        private static var live: Set<ShareSession> = []

        private var onChoose: OnChoose?
        private var onDone: (@MainActor () -> Void)?

        private init(onChoose: @escaping OnChoose) {
            self.onChoose = onChoose
        }

        static func show(_ url: URL, from view: NSView, onChoose: @escaping OnChoose) {
            let session = ShareSession(onChoose: onChoose)
            live.insert(session)
            let picker = NSSharingServicePicker(items: [url])
            picker.delegate = session
            picker.show(relativeTo: view.bounds, of: view, preferredEdge: .minY)
        }

        func sharingServicePicker(
            _ sharingServicePicker: NSSharingServicePicker, delegateFor sharingService: NSSharingService
        ) -> (any NSSharingServiceDelegate)? {
            self
        }

        func sharingServicePicker(_ sharingServicePicker: NSSharingServicePicker, didChoose service: NSSharingService?)
        {
            // Only the closure for the end of the share stays, not what the choice needed.
            onDone = onChoose?(service != nil)
            onChoose = nil
            if service == nil { Self.live.remove(self) }
        }

        func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) {
            finish()
        }

        func sharingService(_ sharingService: NSSharingService, didFailToShareItems items: [Any], error: any Error) {
            finish()
        }

        private func finish() {
            onDone?()
            onDone = nil
            Self.live.remove(self)
        }
    }
#endif
