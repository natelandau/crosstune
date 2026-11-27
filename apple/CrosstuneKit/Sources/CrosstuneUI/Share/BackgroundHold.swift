import CrosstuneSync

#if os(iOS)
    import UIKit

    /// Asks for time to finish while the app moves to the background, until `end()`.
    @MainActor
    public final class BackgroundHold: BackgroundTimeHold {
        private var id = UIBackgroundTaskIdentifier.invalid

        public init(name: String) {
            id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
                self?.end()
            }
        }

        public func end() {
            guard id != .invalid else { return }
            UIApplication.shared.endBackgroundTask(id)
            id = .invalid
        }
    }
#endif

/// The background time a hold asks the system for. Only iOS suspends a running app, so the
/// Mac hold does nothing.
public enum DeviceBackgroundTime {
    #if os(iOS)
        public static let holder: BackgroundTimeHolder = { BackgroundHold(name: $0) }
    #else
        public static let holder: BackgroundTimeHolder = NoBackgroundTimeHold.holder
    #endif
}
