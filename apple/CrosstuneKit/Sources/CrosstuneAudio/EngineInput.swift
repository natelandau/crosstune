@preconcurrency import AVFoundation
import Foundation

#if os(iOS)
    import UIKit
#endif

/// The device microphone, tapped through `AVAudioEngine` from whichever input the system
/// routes to, such as AirPods or a USB interface.
///
/// On iOS it holds a `.playAndRecord` audio session, which with the `audio` background mode
/// keeps recording while the screen is locked or another app is in front.
@MainActor
public final class EngineInput: AudioInput {
    private let runner = EngineRunner()
    private var writer: CaptureWriter?
    private var onLevels: (@MainActor @Sendable ([Float]) -> Void)?
    private var onEvent: (@MainActor @Sendable (AudioInputEvent) -> Void)?
    private var sessionObservers: [NSObjectProtocol] = []
    private var interrupted = false

    public init() {}

    public func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    public func start(
        writer: CaptureWriter, onLevels: @escaping @MainActor @Sendable ([Float]) -> Void,
        onEvent: @escaping @MainActor @Sendable (AudioInputEvent) -> Void
    ) async throws {
        self.writer = writer
        self.onLevels = onLevels
        self.onEvent = onEvent
        interrupted = false
        do {
            try await runner.activateSession()
            // A stop while the session activated has already let go of the take.
            guard self.writer != nil else { throw CancellationError() }
            observeSession()
            try await startEngine()
        } catch {
            await stop()
            throw error
        }
    }

    public func resume() async throws {
        interrupted = false
        try await runner.activateSession()
        try await startEngine()
    }

    public func stop() async {
        for observer in sessionObservers { NotificationCenter.default.removeObserver(observer) }
        sessionObservers = []
        writer = nil
        onLevels = nil
        onEvent = nil
        await runner.stopEngine()
        await runner.deactivateSession()
    }

    private func startEngine() async throws {
        guard let writer, let onLevels, let onEvent else { return }
        try await runner.startEngine(
            writer: writer, onLevels: onLevels, onEvent: onEvent,
            onChange: { [weak self] in Task { @MainActor in await self?.restartAfterChange() } })
    }

    /// The input device or its format changed, which stops the engine: keep recording on
    /// whatever input the system routes to now.
    private func restartAfterChange() async {
        guard !interrupted, writer != nil else { return }
        do {
            try await startEngine()
        } catch {
            await runner.stopEngine()
            onEvent?(.failed)
        }
    }

    #if os(iOS)
        private func observeSession() {
            let center = NotificationCenter.default
            let session = AVAudioSession.sharedInstance()
            sessionObservers = [
                center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) {
                    [weak self] note in
                    let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                    MainActor.assumeIsolated { self?.interruption(raw.flatMap(AVAudioSession.InterruptionType.init)) }
                },
                center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) {
                    [weak self] _ in
                    MainActor.assumeIsolated { self?.routeChanged() }
                },
                center.addObserver(
                    forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated { self?.mediaServicesReset() }
                },
                center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) {
                    [weak self] _ in
                    MainActor.assumeIsolated { self?.becameActive() }
                },
            ]
        }

        private func interruption(_ type: AVAudioSession.InterruptionType?) {
            switch type {
            case .began:
                interrupted = true
                Task { await runner.stopEngine() }
                onEvent?(.interrupted)
            case .ended where interrupted:
                // Left paused even when the system says resuming is fine, so the musician
                // decides whether the take goes on after the call.
                onEvent?(.interruptionEnded)
            default:
                break
            }
        }

        /// The system does not always post an interruption's end, as when the app was in the
        /// background when it ended. Coming back to the app is always a moment to offer resume.
        private func becameActive() {
            guard interrupted else { return }
            onEvent?(.interruptionEnded)
        }

        /// A new route usually changes the engine's configuration, which restarts it; a route
        /// that does not can still leave the engine stopped.
        private func routeChanged() {
            Task {
                guard await runner.isStopped() else { return }
                await restartAfterChange()
            }
        }

        private func mediaServicesReset() {
            guard writer != nil, !interrupted else { return }
            Task { await runner.stopEngine() }
            onEvent?(.failed)
        }
    #else
        private func observeSession() {}
    #endif
}

/// The session and engine calls that can block, such as activating a session that switches a
/// Bluetooth headset to its microphone, run here on a serial queue so they never stall the
/// interface. Serial, so a stop queued after a start always finds the engine that start built.
final class EngineRunner: @unchecked Sendable {
    /// Frames per tap buffer: about a tenth of a second, so levels and the clock update often
    /// without a main-actor hop per display frame.
    private static let tapFrames: AVAudioFrameCount = 4096

    private let queue: DispatchQueue
    /// Told the name of each piece of work as it is queued, so a test can check the order.
    private let onEnqueue: (@Sendable (String) -> Void)?
    /// Touched only on `queue`.
    private var engine: AVAudioEngine?
    private var observer: NSObjectProtocol?

    init(
        queue: DispatchQueue = DispatchQueue(label: "app.crosstune.audio-engine", qos: .userInitiated),
        onEnqueue: (@Sendable (String) -> Void)? = nil
    ) {
        self.queue = queue
        self.onEnqueue = onEnqueue
    }

    /// Queues `body` on the caller's executor rather than after a hop to another one, so work
    /// asked for in order reaches the queue in that order: a stop never overtakes the start
    /// before it.
    nonisolated(nonsending) private func run<T: Sendable>(
        _ name: String, _ body: @escaping @Sendable () throws -> T
    ) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            onEnqueue?(name)
            queue.async { continuation.resume(with: Result { try body() }) }
        }
    }

    /// Builds a fresh engine on the current input. A new engine rather than a restarted one,
    /// since after a device change or a media services reset the old one's input node can
    /// still describe the input that is gone.
    nonisolated(nonsending) func startEngine(
        writer: CaptureWriter, onLevels: @escaping @MainActor @Sendable ([Float]) -> Void,
        onEvent: @escaping @MainActor @Sendable (AudioInputEvent) -> Void, onChange: @escaping @Sendable () -> Void
    ) async throws {
        try await run("start") {
            self.stopNow()
            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw CaptureError.unsupportedFormat }
            input.installTap(
                onBus: 0, bufferSize: Self.tapFrames, format: format,
                block: Self.tap(writer: writer, onLevels: onLevels, onEvent: onEvent))
            engine.prepare()
            do {
                try engine.start()
            } catch {
                input.removeTap(onBus: 0)
                throw error
            }
            self.engine = engine
            self.observer = NotificationCenter.default.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
            ) { _ in onChange() }
        }
    }

    /// Built off the main actor so the block is not isolated to it: the engine calls it on its
    /// own thread, where a main-actor closure would trap.
    private static func tap(
        writer: CaptureWriter, onLevels: @escaping @MainActor @Sendable ([Float]) -> Void,
        onEvent: @escaping @MainActor @Sendable (AudioInputEvent) -> Void
    ) -> AVAudioNodeTapBlock {
        var meter = LevelMeter()
        return { buffer, _ in
            do {
                try writer.write(buffer)
            } catch {
                Task { @MainActor in onEvent(.writeFailed) }
                return
            }
            let levels = meter.levels(of: buffer)
            Task { @MainActor in onLevels(levels) }
        }
    }

    nonisolated(nonsending) func stopEngine() async {
        _ = try? await run("stop") { self.stopNow() }
    }

    /// True when the engine is built but not running, as after a route change that stopped it.
    /// False with no engine at all: only a deliberate stop clears it, and that is not undone here.
    nonisolated(nonsending) func isStopped() async -> Bool {
        (try? await run("isStopped") { self.engine.map { !$0.isRunning } ?? false }) ?? false
    }

    private func stopNow() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
    }

    #if os(iOS)
        nonisolated(nonsending) func activateSession() async throws {
            try await run("activate") {
                let session = AVAudioSession.sharedInstance()
                // Full-bandwidth Bluetooth recording where the headset supports it, such as recent
                // AirPods, and HFP otherwise, so any headset records rather than only plays.
                try session.setCategory(
                    .playAndRecord, mode: .default,
                    options: [.bluetoothHighQualityRecording, .allowBluetoothHFP, .defaultToSpeaker])
                try? session.setPreferredSampleRate(CaptureWriter.sampleRate)
                try session.setActive(true)
            }
        }

        nonisolated(nonsending) func deactivateSession() async {
            _ = try? await run("deactivate") {
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            }
        }
    #else
        // No session on macOS, but the steps still take their place in line.
        nonisolated(nonsending) func activateSession() async throws {
            try await run("activate") {}
        }

        nonisolated(nonsending) func deactivateSession() async {
            _ = try? await run("deactivate") {}
        }
    #endif
}
