@preconcurrency import AVFoundation
import CrosstuneAudio
import CrosstuneStore
import Foundation

/// A tone as the microphone would deliver it: Float32, non-interleaved, at the given rate.
public func sineBuffer(
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
public func writeTone(
    to url: URL, seconds: Double, bitrate: Int = 64_000, channels: Int = 1, amplitude: Float = 0.5,
    close: Bool = true
) throws -> CaptureWriter {
    let writer = try CaptureWriter(url: url, bitrate: bitrate, channels: channels)
    for _ in 0..<Int(seconds * 10) { try writer.write(sineBuffer(seconds: 0.1, amplitude: amplitude)) }
    if close { writer.close() }
    return writer
}

public func duration(of url: URL) async throws -> Double {
    try await AVURLAsset(url: url).load(.duration).seconds
}

public func fileExists(_ url: URL) -> Bool {
    FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
}

/// A new capture file in `folder`, with the extension the recorder gives one, so a test writes
/// the same container a crash would leave behind.
public func captureURL(in folder: URL) -> URL {
    folder.appending(path: "\(UUID().uuidString).\(CrosstuneStore.captureExtension)")
}
