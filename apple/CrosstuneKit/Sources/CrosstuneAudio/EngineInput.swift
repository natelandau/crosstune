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
    /// Set from a prepare until the next stop, so a prepare can tell a stop arrived meanwhile.
    private var preparing = false
    /// Fixed for the take, so a resume never swaps left and right partway through.
    private var stereo: EngineRunner.StereoRequest?

    public init() {}

    public func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    public func prepare(preferring channels: CaptureChannels) async throws -> Int {
        preparing = true
        interrupted = false
        stereo = channels == .stereo ? Self.stereoRequest() : nil
        do {
            try await runner.activateSession(stereo: stereo)
            // A stop while the session activated has already let go of the take.
            guard preparing else { throw CancellationError() }
            observeSession()
            return await runner.inputChannelCount()
        } catch {
            await stop()
            throw error
        }
    }

    public func start(
        writer: CaptureWriter, onLevels: @escaping @MainActor @Sendable ([Float]) -> Void,
        onEvent: @escaping @MainActor @Sendable (AudioInputEvent) -> Void
    ) async throws {
        self.writer = writer
        self.onLevels = onLevels
        self.onEvent = onEvent
        do {
            // An interruption since prepare went unreported, as nothing listened yet.
            if interrupted { throw CancellationError() }
            try await startEngine()
        } catch {
            await stop()
            throw error
        }
    }

    public func resume() async throws {
        interrupted = false
        try await runner.activateSession(stereo: stereo)
        try await startEngine()
    }

    public func stop() async {
        for observer in sessionObservers { NotificationCenter.default.removeObserver(observer) }
        sessionObservers = []
        preparing = false
        stereo = nil
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
        /// Stereo from the built-in microphone, with left and right as the screen shows them
        /// when the take starts.
        private static func stereoRequest() -> EngineRunner.StereoRequest {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.keyWindow != nil }
            let orientation: AVAudioSession.StereoOrientation =
                switch scene?.effectiveGeometry.interfaceOrientation {
                case .portraitUpsideDown: .portraitUpsideDown
                case .landscapeLeft: .landscapeLeft
                case .landscapeRight: .landscapeRight
                default: .portrait
                }
            return EngineRunner.StereoRequest(orientation: orientation)
        }

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
        private static func stereoRequest() -> EngineRunner.StereoRequest {
            EngineRunner.StereoRequest()
        }

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
        var peakMeter = PeakMeter()
        return { buffer, _ in
            do {
                try writer.write(buffer)
            } catch {
                Task { @MainActor in onEvent(.writeFailed) }
                return
            }
            let levels = meter.levels(of: buffer)
            Task { @MainActor in onLevels(levels) }
            writer.appendPeaks(peakMeter.peaks(of: buffer))
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
        /// Asks the session for stereo capture, aimed for the interface orientation given.
        struct StereoRequest: Sendable {
            let orientation: AVAudioSession.StereoOrientation
        }

        nonisolated(nonsending) func activateSession(stereo: StereoRequest?) async throws {
            try await run("activate") {
                let session = AVAudioSession.sharedInstance()
                // Full-bandwidth Bluetooth recording where the headset supports it, such as recent
                // AirPods, and HFP otherwise, so any headset records rather than only plays.
                try session.setCategory(
                    .playAndRecord, mode: .default,
                    options: [.bluetoothHighQualityRecording, .allowBluetoothHFP, .defaultToSpeaker])
                try? session.setPreferredSampleRate(CaptureWriter.sampleRate)
                try session.setActive(true)
                if let stereo { Self.configureStereo(session, stereo) } else { Self.resetStereo(session) }
            }
        }

        /// Every step may fail on a device without stereo, which then records mono.
        private static func configureStereo(_ session: AVAudioSession, _ request: StereoRequest) {
            if let port = session.currentRoute.inputs.first, port.portType == .builtInMic,
                let source = port.dataSources?.first(where: {
                    $0.orientation == .front && $0.supportedPolarPatterns?.contains(.stereo) == true
                })
            {
                try? source.setPreferredPolarPattern(.stereo)
                try? port.setPreferredDataSource(source)
                try? session.setPreferredInputOrientation(request.orientation)
            }
            // Last, since the built-in microphone reports one channel until its stereo pattern
            // is chosen.
            try? session.setPreferredInputNumberOfChannels(min(2, session.maximumInputNumberOfChannels))
        }

        /// The session and the built-in port keep a stereo setup for the life of the process, so
        /// a mono take clears it to record from the default microphone. Any other input keeps
        /// both its channels, which the capture file mixes down rather than dropping the second.
        private static func resetStereo(_ session: AVAudioSession) {
            if let port = session.availableInputs?.first(where: { $0.portType == .builtInMic }) {
                for source in port.dataSources ?? [] { try? source.setPreferredPolarPattern(nil) }
                try? port.setPreferredDataSource(nil)
            }
            let builtIn = session.currentRoute.inputs.first?.portType == .builtInMic
            try? session.setPreferredInputNumberOfChannels(
                builtIn ? 1 : min(2, session.maximumInputNumberOfChannels))
        }

        nonisolated(nonsending) func inputChannelCount() async -> Int {
            (try? await run("channels") { AVAudioSession.sharedInstance().inputNumberOfChannels }) ?? 1
        }

        nonisolated(nonsending) func deactivateSession() async {
            _ = try? await run("deactivate") {
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            }
        }
    #else
        /// macOS has no session setting for stereo; the input's own channels decide.
        struct StereoRequest: Sendable {}

        // No session on macOS, but the steps still take their place in line.
        nonisolated(nonsending) func activateSession(stereo: StereoRequest?) async throws {
            try await run("activate") {}
        }

        nonisolated(nonsending) func inputChannelCount() async -> Int {
            (try? await run("channels") { Int(AVAudioEngine().inputNode.outputFormat(forBus: 0).channelCount) }) ?? 1
        }

        nonisolated(nonsending) func deactivateSession() async {
            _ = try? await run("deactivate") {}
        }
    #endif
}
