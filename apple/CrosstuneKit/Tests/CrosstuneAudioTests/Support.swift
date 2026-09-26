@preconcurrency import AVFoundation
import CrosstuneAudio
import Foundation

/// A tone as the microphone would deliver it: Float32, non-interleaved, at the given rate.
func sineBuffer(
    seconds: Double, sampleRate: Double = 44_100, channels: AVAudioChannelCount = 2, amplitude: Float = 0.5,
    frequency: Double = 440
) -> AVAudioPCMBuffer {
    let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: channels)!
    let frames = AVAudioFrameCount((seconds * sampleRate).rounded())
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
    buffer.frameLength = frames
    for channel in 0..<Int(channels) {
        let samples = buffer.floatChannelData![channel]
        for frame in 0..<Int(frames) {
            samples[frame] = amplitude * Float(sin(2 * .pi * frequency * Double(frame) / sampleRate))
        }
    }
    return buffer
}

/// Writes `seconds` of tone through a ``CaptureWriter`` in tap-sized buffers and returns it,
/// still open unless `close` is set.
@discardableResult
func writeTone(to url: URL, seconds: Double, bitrate: Int = 64_000, close: Bool = true) throws -> CaptureWriter {
    let writer = try CaptureWriter(url: url, bitrate: bitrate)
    for _ in 0..<Int(seconds * 10) { try writer.write(sineBuffer(seconds: 0.1)) }
    if close { writer.close() }
    return writer
}

func duration(of url: URL) async throws -> Double {
    try await AVURLAsset(url: url).load(.duration).seconds
}

func fileExists(_ url: URL) -> Bool {
    FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
}

/// A microphone that records a tone on demand, standing in for the engine in tests.
@MainActor
final class FakeInput: AudioInput {
    var permission = true
    /// While set, a permission request waits until ``answerPermission()``, as the system
    /// prompt does.
    var holdsPermission = false
    var failsToStart = false
    var failsToResume = false
    private(set) var started = 0
    private var meter = LevelMeter()
    private var pendingPermission: CheckedContinuation<Bool, Never>?
    /// While set, starting and resuming wait until ``finishStarting()``, as a slow session
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

    func start(
        writer: CaptureWriter, onLevels: @escaping @MainActor @Sendable ([Float]) -> Void,
        onEvent: @escaping @MainActor @Sendable (AudioInputEvent) -> Void
    ) async throws {
        if holdsStart { await withCheckedContinuation { pendingStart = $0 } }
        if failsToStart { throw CaptureError.unsupportedFormat }
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

    /// Waits until a start or resume is held.
    func startIsHeld() async {
        while pendingStart == nil { await Task.yield() }
    }

    /// Lets a held start or resume finish.
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
