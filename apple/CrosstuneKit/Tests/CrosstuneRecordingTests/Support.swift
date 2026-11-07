import CrosstuneAudio
import CrosstuneStore
import CrosstuneTestSupport
import Foundation

@testable import CrosstuneRecording

/// A microphone that records a tone on demand, in place of the engine in tests.
@MainActor
final class FakeInput: AudioInput {
    var permission = true
    /// While set, a permission request waits until ``answerPermission()``, as the system
    /// prompt does.
    var holdsPermission = false
    /// Fails the prepare step.
    var failsToStart = false
    /// Fails the start that follows a successful prepare.
    var failsToStartEngine = false
    var failsToResume = false
    /// The channel count ``prepare(preferring:)`` reports.
    var inputChannels = 2
    private(set) var preferred: CaptureChannels?
    private(set) var started = 0
    private var meter = LevelMeter()
    private var pendingPermission: CheckedContinuation<Bool, Never>?
    /// While set, preparing and resuming wait until ``finishStarting()``, as a slow session
    /// activation does.
    var holdsStart = false
    private var pendingStart: CheckedContinuation<Void, Never>?
    private(set) var writer: CaptureWriter?
    private(set) var resumed = 0
    private(set) var stopped = false
    private var onLevels: (@MainActor @Sendable ([Float]) -> Void)?
    private var onEvent: (@MainActor @Sendable (AudioInputEvent) -> Void)?

    func requestPermission() async -> Bool {
        guard holdsPermission else { return permission }
        return await withCheckedContinuation { pendingPermission = $0 }
    }

    /// Answers a held permission request.
    func answerPermission() async {
        while pendingPermission == nil { await Task.yield() }
        pendingPermission?.resume(returning: permission)
        pendingPermission = nil
    }

    func prepare(preferring channels: CaptureChannels) async throws -> Int {
        preferred = channels
        if holdsStart { await withCheckedContinuation { pendingStart = $0 } }
        if failsToStart { throw CaptureError.unsupportedFormat }
        return inputChannels
    }

    func start(
        writer: CaptureWriter, onLevels: @escaping @MainActor @Sendable ([Float]) -> Void,
        onEvent: @escaping @MainActor @Sendable (AudioInputEvent) -> Void
    ) async throws {
        if failsToStartEngine { throw CaptureError.unsupportedFormat }
        started += 1
        self.writer = writer
        self.onLevels = onLevels
        self.onEvent = onEvent
    }

    func resume() async throws {
        if holdsStart { await withCheckedContinuation { pendingStart = $0 } }
        if failsToResume { throw CaptureError.unsupportedFormat }
        resumed += 1
    }

    /// Waits until a prepare or resume is held.
    func startIsHeld() async {
        while pendingStart == nil { await Task.yield() }
    }

    /// Lets a held prepare or resume finish.
    func finishStarting() async {
        await startIsHeld()
        pendingStart?.resume()
        pendingStart = nil
    }

    func stop() {
        stopped = true
        onLevels = nil
        onEvent = nil
    }

    /// Delivers `seconds` of tone as the tap would: written to the file, then its levels.
    func play(seconds: Double) throws {
        let buffer = sineBuffer(seconds: seconds)
        try writer?.write(buffer)
        onLevels?(meter.levels(of: buffer))
    }

    func send(_ event: AudioInputEvent) {
        onEvent?(event)
    }
}
