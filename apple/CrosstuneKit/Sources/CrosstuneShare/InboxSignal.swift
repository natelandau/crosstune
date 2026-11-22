import CoreFoundation
import Foundation

/// Tells a running app that the share extension added to the inbox. A Darwin notification
/// crosses the process boundary but carries no data, so the app reads the inbox on each one.
public enum InboxSignal {
    public static let name = "app.crosstune.Crosstune.share-inbox"

    public static func post() {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil, true)
    }

    /// Calls `handler` on the main actor on each signal until the returned token is released.
    @MainActor
    public static func observe(_ handler: @escaping @MainActor () -> Void) -> InboxSignalToken {
        let token = InboxSignalToken(handler: handler)
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(token).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else { return }
                // The Darwin center calls observers on the main thread.
                MainActor.assumeIsolated {
                    Unmanaged<InboxSignalToken>.fromOpaque(observer).takeUnretainedValue().handler()
                }
            },
            name as CFString, nil, .deliverImmediately)
        return token
    }
}

/// Keeps an ``InboxSignal`` observer registered while held. The center holds only an unretained
/// pointer to it, so it is made, called, and released on the main actor: a release on another
/// thread could free it in the middle of a call.
@MainActor
public final class InboxSignalToken {
    fileprivate let handler: @MainActor () -> Void

    fileprivate init(handler: @escaping @MainActor () -> Void) {
        self.handler = handler
    }

    isolated deinit {
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(InboxSignal.name as CFString), nil)
    }
}
