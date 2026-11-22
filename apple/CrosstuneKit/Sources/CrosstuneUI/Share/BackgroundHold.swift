#if os(iOS)
    import UIKit

    /// Asks for time to finish while the app moves to the background, until `end()`.
    @MainActor
    final class BackgroundHold {
        private var id = UIBackgroundTaskIdentifier.invalid

        init(name: String) {
            id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
                self?.end()
            }
        }

        func end() {
            guard id != .invalid else { return }
            UIApplication.shared.endBackgroundTask(id)
            id = .invalid
        }
    }
#endif
