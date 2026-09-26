/// Something that happened to the microphone that a ``Recorder`` must respond to.
public enum AudioInputEvent: Equatable, Sendable {
    /// Another app, such as a phone call, took the microphone. Capture has stopped.
    case interrupted
    /// The interruption is over, so capture can resume.
    case interruptionEnded
    /// The input could not restart after a device or route change. Capture has stopped and
    /// can be retried.
    case failed
    /// The capture file could not be written, as when the disk is full.
    case writeFailed
}

/// The microphone behind a ``Recorder``. ``EngineInput`` is the device's; a test substitutes
/// one that writes a generated signal.
@MainActor
public protocol AudioInput: AnyObject {
    /// Asks for microphone access. The system asks the user once; later calls return that
    /// answer.
    func requestPermission() async -> Bool

    /// Starts sending the microphone's audio to `writer`, reporting each buffer's levels and
    /// every event.
    func start(
        writer: CaptureWriter, onLevels: @escaping @MainActor @Sendable ([Float]) -> Void,
        onEvent: @escaping @MainActor @Sendable (AudioInputEvent) -> Void
    ) async throws

    /// Starts capture again after an interruption or a failed restart.
    func resume() async throws

    /// Stops capture and releases the microphone. No callback is made after this.
    func stop() async
}
