#if os(iOS)
    import SwiftUI
    import VisionKit

    /// VisionKit's document camera: one session takes several pages, and its own screens find
    /// the edges, crop, and filter each one. Returns the pages in the order taken. Show it only
    /// where `VNDocumentCameraViewController.isSupported`.
    struct DocumentScanner: UIViewControllerRepresentable {
        let onFinish: @MainActor ([CGImage]) -> Void
        let onCancel: @MainActor () -> Void

        func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
            let controller = VNDocumentCameraViewController()
            controller.delegate = context.coordinator
            return controller
        }

        func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {
            context.coordinator.parent = self
        }

        func makeCoordinator() -> Coordinator {
            Coordinator(parent: self)
        }

        @MainActor
        final class Coordinator: NSObject, @preconcurrency VNDocumentCameraViewControllerDelegate {
            var parent: DocumentScanner

            init(parent: DocumentScanner) {
                self.parent = parent
            }

            func documentCameraViewController(
                _ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan
            ) {
                // A scanned page comes back upright, so its pixels need no orientation applied.
                parent.onFinish((0..<scan.pageCount).compactMap { scan.imageOfPage(at: $0).cgImage })
            }

            func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
                parent.onCancel()
            }

            func documentCameraViewController(
                _ controller: VNDocumentCameraViewController, didFailWithError error: any Error
            ) {
                parent.onCancel()
            }
        }
    }

    /// The document camera over the whole shell, closing itself once it returns.
    struct ScanSheet: View {
        let onFinish: @MainActor ([CGImage]) -> Void

        @Environment(\.dismiss) private var dismiss

        var body: some View {
            DocumentScanner(
                onFinish: { images in
                    dismiss()
                    onFinish(images)
                },
                onCancel: { dismiss() }
            )
            .ignoresSafeArea()
            .shellSheet()
        }
    }
#endif
