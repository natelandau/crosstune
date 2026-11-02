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
///
/// The right channel of a two-channel file takes `rightAmplitude` and `rightFrequency` when
/// given, and otherwise matches the left.
@discardableResult
public func writeTone(
    to url: URL, seconds: Double, bitrate: Int = 64_000, channels: Int = 1, amplitude: Float = 0.5,
    frequency: Double = 440, rightAmplitude: Float? = nil, rightFrequency: Double? = nil, close: Bool = true
) throws -> CaptureWriter {
    let writer = try CaptureWriter(url: url, bitrate: bitrate, channels: channels)
    for _ in 0..<Int(seconds * 10) {
        let buffer = sineBuffer(seconds: 0.1, amplitude: amplitude, frequency: frequency)
        if rightAmplitude != nil || rightFrequency != nil {
            let right = sineBuffer(
                seconds: 0.1, channels: 1, amplitude: rightAmplitude ?? amplitude,
                frequency: rightFrequency ?? frequency)
            buffer.floatChannelData![1].update(from: right.floatChannelData![0], count: Int(right.frameLength))
        }
        try writer.write(buffer)
    }
    if close { writer.close() }
    return writer
}

/// Writes `seconds` of the same tone on every one of `channels` to an uncompressed WAV file,
/// tagged with `layout` when given. Without a layout, a file over two channels does not say which
/// speaker each channel feeds.
public func writeMultichannelTone(
    to url: URL, seconds: Double, channels: Int, layout: AudioChannelLayoutTag? = nil, sampleRate: Double = 44_100
) throws {
    var settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: channels,
        AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false,
    ]
    if let layout {
        var channelLayout = AudioChannelLayout()
        channelLayout.mChannelLayoutTag = layout
        settings[AVChannelLayoutKey] = Data(bytes: &channelLayout, count: MemoryLayout<AudioChannelLayout>.size)
    }
    let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    let frames = AVAudioFrameCount((seconds * sampleRate).rounded())
    let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames)!
    buffer.frameLength = frames
    for channel in 0..<channels {
        let samples = buffer.floatChannelData![channel]
        for frame in 0..<Int(frames) { samples[frame] = 0.5 * Float(sin(2 * .pi * 440 * Double(frame) / sampleRate)) }
    }
    try file.write(from: buffer)
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
