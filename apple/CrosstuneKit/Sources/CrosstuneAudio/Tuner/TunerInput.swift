@preconcurrency import AVFoundation
import Foundation
import Synchronization

#if os(iOS)
    import UIKit
#endif

/// A start that a stop or a yield to playback overtook, which is no failure of the microphone.
public struct TunerStartOvertaken: Error {
    public init() {}
}

/// What a tuner hears of playback taking the audio session.
public enum TunerYield: Sendable {
    /// Playback is about to set the session up: the input let go of it, and its engine waits
    /// for a stop.
    case yielded
    /// The play the tuner yielded to did not start, so the tuner may listen again.
    case playbackDidNotStart
}

/// The microphone the tuner listens through.
@MainActor
public protocol TunerListening: AnyObject {
    func requestPermission() async -> Bool
    /// Starts the mic and delivers readings (nil when nothing confident) on the main actor.
    /// `onEnded` reports that the microphone went away and the input has already let go of it.
    /// `onYield` reports playback taking the session, and a play it yielded to that never started.
    func start(
        a4: Double, onReading: @escaping @MainActor @Sendable (Reading?) -> Void,
        onEnded: @escaping @MainActor @Sendable () -> Void,
        onYield: @escaping @MainActor @Sendable (TunerYield) -> Void
    ) async throws
    func setA4(_ a4: Double)
    func stop() async
}

/// The tuners that a yield to playback reaches, and the session claims the yield counts on.
/// The app has one, ``shared``; a test makes its own so its tuners hear only its yields.
@MainActor
final class TunerRegistry {
    static let shared = TunerRegistry(claims: .shared)

    nonisolated let claims: AudioSessionClaims
    /// Each tuner that holds the microphone, by how it yields its session.
    fileprivate var listeners: [ObjectIdentifier: @MainActor () -> Void] = [:]
    /// Each tuner that yielded to a play not yet known to have started, by how it is told it
    /// did not.
    fileprivate var yielded: [ObjectIdentifier: @MainActor () -> Void] = [:]

    init(claims: AudioSessionClaims) {
        self.claims = claims
    }

    func yieldToPlayback() {
        claims.yieldToPlayback()
        for yieldNow in Array(listeners.values) { yieldNow() }
    }

    func playbackDidNotStart() {
        let told = yielded
        yielded = [:]
        for tell in told.values { tell() }
    }
}

/// The device microphone, read raw for pitch through an engine of its own.
///
/// On iOS it holds a `.record` session in `.measurement` mode, which turns off the voice
/// processing that cuts the low notes a bass sounds. An interruption such as a call stops it,
/// and it listens again once the interruption ends.
@MainActor
public final class TunerInput: TunerListening {
    /// Lets go of every tuner's session at once, before playback sets the audio session up for
    /// itself. A tuner left holding it would take the change for a failed microphone; its owner
    /// still stops it, which then leaves the player's session alone.
    public static func yieldToPlayback() {
        TunerRegistry.shared.yieldToPlayback()
    }

    /// Tells every tuner that yielded that the play it yielded to did not start, such as a
    /// player that failed to start or a song loaded paused.
    public static func playbackDidNotStart() {
        TunerRegistry.shared.playbackDidNotStart()
    }

    /// Whether this tuner holds the microphone, until it stops or yields to playback.
    var holdsMicrophone: Bool { registry.listeners[ObjectIdentifier(self)] != nil }

    private let engine: any TunerEngine
    private let registry: TunerRegistry
    private let pitch = ReferencePitch(440)
    private var onReading: (@MainActor @Sendable (Reading?) -> Void)?
    private var onEnded: (@MainActor @Sendable () -> Void)?
    private var onYield: (@MainActor @Sendable (TunerYield) -> Void)?
    /// Changes on every start, stop, and interruption, so readings an earlier engine sent are
    /// dropped and work that waited on the engine can tell it was overtaken.
    private var generation = 0
    private var interrupted = false
    private var sessionObservers: [NSObjectProtocol] = []

    public convenience init() {
        self.init(engine: TunerRunner())
    }

    init(engine: any TunerEngine, registry: TunerRegistry = .shared) {
        self.engine = engine
        self.registry = registry
    }

    isolated deinit {
        release()
        registry.yielded[ObjectIdentifier(self)] = nil
    }

    public func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    public func start(
        a4: Double, onReading: @escaping @MainActor @Sendable (Reading?) -> Void,
        onEnded: @escaping @MainActor @Sendable () -> Void,
        onYield: @escaping @MainActor @Sendable (TunerYield) -> Void
    ) async throws {
        release()
        registry.yielded[ObjectIdentifier(self)] = nil
        registry.listeners[ObjectIdentifier(self)] = { [weak self] in self?.yieldNow() }
        pitch.value = a4
        self.onReading = onReading
        self.onEnded = onEnded
        self.onYield = onYield
        let started = generation
        do {
            try await engine.activate(unlessYieldedSince: registry.claims.yields)
            guard started == generation else { throw TunerStartOvertaken() }
            observeSession()
            try await startEngine()
        } catch {
            if started == generation { await stop() }
            throw error is YieldedToPlayback ? TunerStartOvertaken() : error
        }
    }

    public func setA4(_ a4: Double) {
        pitch.value = a4
    }

    public func stop() async {
        release()
        await engine.stop()
        await engine.deactivate()
    }

    private var listening: Bool { onReading != nil }

    private func yieldNow() {
        let onYield = onYield
        release()
        guard let onYield else { return }
        registry.yielded[ObjectIdentifier(self)] = { onYield(.playbackDidNotStart) }
        onYield(.yielded)
    }

    /// Forgets the session at once, so nothing it sent or started is acted on after this.
    private func release() {
        for observer in sessionObservers { NotificationCenter.default.removeObserver(observer) }
        sessionObservers = []
        onReading = nil
        onEnded = nil
        onYield = nil
        interrupted = false
        generation += 1
        registry.listeners[ObjectIdentifier(self)] = nil
    }

    private func startEngine() async throws {
        let current = generation
        try await engine.start(
            pitch: pitch,
            onReading: { [weak self] reading in
                guard let self, self.generation == current else { return }
                self.onReading?(reading)
            },
            onChange: { [weak self] in Task { @MainActor in await self?.configurationChanged() } })
    }

    /// The input device or its format changed, which stops the engine: listen on whatever
    /// input the system routes to now, with a tracker at its rate.
    func configurationChanged() async {
        guard listening, !interrupted else { return }
        let current = generation
        do {
            try await startEngine()
        } catch {
            guard current == generation else { return }
            await end()
        }
    }

    func interruptionBegan() async {
        guard listening, !interrupted else { return }
        interrupted = true
        generation += 1
        onReading?(nil)
        await engine.stop()
    }

    func interruptionEnded() async {
        guard listening, interrupted else { return }
        interrupted = false
        await startOver(afterInterruption: true)
    }

    func mediaServicesReset() async {
        guard listening, !interrupted else { return }
        generation += 1
        await engine.stop()
        await startOver(afterInterruption: false)
    }

    /// A new route usually changes the engine's configuration, which restarts it; a route
    /// that does not can still leave the engine stopped.
    func routeChanged() async {
        guard listening, !interrupted, await engine.isStopped() else { return }
        await configurationChanged()
    }

    /// Sets the session up again and builds a new engine, as after the system took the
    /// session away.
    private func startOver(afterInterruption: Bool) async {
        let current = generation
        do {
            try await engine.activate(unlessYieldedSince: registry.claims.yields)
        } catch {
            guard current == generation else { return }
            // Another app, such as a call still on hold, keeps the session for now: wait for
            // the next interruption end or return to the app rather than giving up.
            if afterInterruption, Self.isBusy(error) {
                interrupted = true
                return
            }
            await end()
            return
        }
        guard current == generation else { return }
        do {
            try await startEngine()
        } catch {
            guard current == generation else { return }
            await end()
        }
    }

    #if os(iOS)
        private static let busyCode = AVAudioSession.ErrorCode.insufficientPriority.rawValue
    #else
        /// `AVAudioSession.ErrorCode.insufficientPriority`, `'!pri'`, which macOS does not declare.
        private static let busyCode = 0x2170_7269
    #endif

    static func isBusy(_ error: any Error) -> Bool {
        (error as NSError).code == busyCode
    }

    private func end() async {
        let onEnded = onEnded
        release()
        onEnded?()
        await engine.stop()
        await engine.deactivate()
    }

    #if os(iOS)
        private func observeSession() {
            let center = NotificationCenter.default
            let session = AVAudioSession.sharedInstance()
            sessionObservers = [
                center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) {
                    [weak self] note in
                    let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                    let type = raw.flatMap(AVAudioSession.InterruptionType.init)
                    Task { @MainActor in
                        switch type {
                        case .began: await self?.interruptionBegan()
                        case .ended: await self?.interruptionEnded()
                        default: break
                        }
                    }
                },
                center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) {
                    [weak self] _ in
                    Task { @MainActor in await self?.routeChanged() }
                },
                center.addObserver(
                    forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main
                ) { [weak self] _ in
                    Task { @MainActor in await self?.mediaServicesReset() }
                },
                // The system does not always post an interruption's end, as when the app was in
                // the background when it ended.
                center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) {
                    [weak self] _ in
                    Task { @MainActor in await self?.interruptionEnded() }
                },
            ]
        }
    #else
        private func observeSession() {}
    #endif
}

/// The reference pitch the tap reads before each buffer, set from the main actor.
final class ReferencePitch: Sendable {
    private let state: Mutex<Double>

    init(_ a4: Double) {
        state = Mutex(a4)
    }

    var value: Double {
        get { state.withLock { $0 } }
        set { state.withLock { $0 = newValue } }
    }
}

/// Feeds one engine's tap buffers to a tracker and passes on each reading that differs from
/// the last one passed, so silence costs no main-actor hops. Owned by the tap, which the
/// engine calls serially.
final class TunerTap {
    private let tracker: PitchTracker
    private let pitch: ReferencePitch
    private var a4: Double
    /// `.none` until the first buffer, which always passes its reading on, so a new engine
    /// that hears only silence still clears a note an earlier one left showing.
    private var last: Reading??

    init(sampleRate: Double, pitch: ReferencePitch) {
        self.pitch = pitch
        a4 = pitch.value
        tracker = PitchTracker(sampleRate: sampleRate, a4: a4)
    }

    func process(_ samples: UnsafeBufferPointer<Float>, deliver: (Reading?) -> Void) {
        let wanted = pitch.value
        if wanted != a4 {
            a4 = wanted
            tracker.setA4(wanted)
        }
        let reading = tracker.push(samples)
        guard reading != last else { return }
        last = reading
        deliver(reading)
    }
}

/// The session and engine work behind ``TunerInput``, which a test replaces.
protocol TunerEngine: Sendable {
    /// Sets the session up, unless the tuner yielded to playback since `yields` was read from
    /// ``AudioSessionClaims``; then it throws ``YieldedToPlayback`` and leaves the session alone.
    nonisolated(nonsending) func activate(unlessYieldedSince yields: UInt64) async throws
    /// Builds a fresh engine on the current input, replacing any running one.
    nonisolated(nonsending) func start(
        pitch: ReferencePitch, onReading: @escaping @MainActor @Sendable (Reading?) -> Void,
        onChange: @escaping @Sendable () -> Void
    ) async throws
    /// True when the engine is built but not running.
    nonisolated(nonsending) func isStopped() async -> Bool
    nonisolated(nonsending) func stop() async
    nonisolated(nonsending) func deactivate() async
}

/// Runs the session and engine calls that can block on a serial queue, so they never stall
/// the interface and a stop queued after a start always finds the engine that start built.
final class TunerRunner: TunerEngine, @unchecked Sendable {
    /// About 21 ms at 48 kHz, close to the tracker's hop, so each buffer brings about one
    /// new analysis.
    private static let tapFrames: AVAudioFrameCount = 1024

    private let queue = DispatchQueue(label: "app.crosstune.tuner-engine", qos: .userInitiated)
    /// Touched only on `queue`.
    private var engine: AVAudioEngine?
    private var observer: NSObjectProtocol?
    private let sessionOwner = AudioSessionOwner()
    /// The yields the last setup was asked for after. Touched only on `queue`.
    private var claimedAfter: UInt64?
    private let claims: AudioSessionClaims
    private let session: any TunerSession

    init(claims: AudioSessionClaims = .shared, session: any TunerSession = DeviceTunerSession()) {
        self.claims = claims
        self.session = session
    }

    /// Queues `body` on the caller's executor rather than after a hop, so work asked for in
    /// order reaches the queue in that order.
    nonisolated(nonsending) private func run<T: Sendable>(_ body: @escaping @Sendable () throws -> T) async throws
        -> T
    {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { continuation.resume(with: Result { try body() }) }
        }
    }

    nonisolated(nonsending) func start(
        pitch: ReferencePitch, onReading: @escaping @MainActor @Sendable (Reading?) -> Void,
        onChange: @escaping @Sendable () -> Void
    ) async throws {
        try await run {
            self.stopNow()
            // A new engine rather than a restarted one, since after a device change the old
            // one's input node can still describe the input that is gone.
            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw CaptureError.unsupportedFormat }
            input.installTap(
                onBus: 0, bufferSize: Self.tapFrames, format: format,
                block: Self.tap(sampleRate: format.sampleRate, pitch: pitch, onReading: onReading))
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
        sampleRate: Double, pitch: ReferencePitch, onReading: @escaping @MainActor @Sendable (Reading?) -> Void
    ) -> AVAudioNodeTapBlock {
        let tap = TunerTap(sampleRate: sampleRate, pitch: pitch)
        return { buffer, _ in
            guard let channel = buffer.floatChannelData?[0] else { return }
            tap.process(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength))) { reading in
                // The main queue rather than a task, so readings arrive in the order heard.
                DispatchQueue.main.async { MainActor.assumeIsolated { onReading(reading) } }
            }
        }
    }

    nonisolated(nonsending) func isStopped() async -> Bool {
        (try? await run { self.engine.map { !$0.isRunning } ?? false }) ?? false
    }

    nonisolated(nonsending) func stop() async {
        _ = try? await run { self.stopNow() }
    }

    private func stopNow() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
    }

    nonisolated(nonsending) func activate(unlessYieldedSince yields: UInt64) async throws {
        try await run {
            self.claimedAfter = yields
            try self.claims.claim(self.sessionOwner, unlessYieldedSince: yields) { try self.session.setUp() }
        }
    }

    nonisolated(nonsending) func deactivate() async {
        _ = try? await run {
            self.claims.release(self.sessionOwner, unlessYieldedSince: self.claimedAfter) { self.session.tearDown() }
        }
    }
}

/// The audio session work a tuner does around listening, which a test replaces.
protocol TunerSession: Sendable {
    func setUp() throws
    func tearDown()
}

/// The device's session: a `.record` session in `.measurement` mode on iOS, nothing on macOS.
struct DeviceTunerSession: TunerSession {
    func setUp() throws {
        #if os(iOS)
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement)
            try session.setActive(true)
        #endif
    }

    func tearDown() {
        #if os(iOS)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}
