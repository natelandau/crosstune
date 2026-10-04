import MediaPlayer

/// The system's next and previous track commands: the lock screen, Control Center, headphone
/// buttons, CarPlay, and the Mac's media keys.
@MainActor
public protocol TrackCommands: AnyObject {
    /// Offers next and previous, replacing any handlers given before.
    func enable(next: @escaping @MainActor () -> Void, previous: @escaping @MainActor () -> Void)
    /// Stops offering them and drops the handlers.
    func disable()
}

/// ``TrackCommands`` on `MPRemoteCommandCenter`. It adds and removes only its own targets, so the
/// transport commands the player registers are never touched.
@MainActor
public final class RemoteTrackCommands: TrackCommands {
    private var registrations: [(command: MPRemoteCommand, target: Any)] = []

    public init() {}

    isolated deinit {
        disable()
    }

    public func enable(next: @escaping @MainActor () -> Void, previous: @escaping @MainActor () -> Void) {
        disable()
        let center = MPRemoteCommandCenter.shared()
        register(center.nextTrackCommand, next)
        register(center.previousTrackCommand, previous)
    }

    public func disable() {
        for registration in registrations {
            registration.command.removeTarget(registration.target)
            registration.command.isEnabled = false
        }
        registrations = []
    }

    private func register(_ command: MPRemoteCommand, _ handle: @escaping @MainActor () -> Void) {
        command.isEnabled = true
        // The system calls the handler on the main thread.
        let target = command.addTarget { _ in
            MainActor.assumeIsolated {
                handle()
                return .success
            }
        }
        registrations.append((command, target))
    }
}
