@preconcurrency import AVFoundation
import Foundation

/// Whether a recording is mono: its channels carry the same audio, so it has no stereo field.
///
/// The server measures with the same rule, so both agree on any one file.
public enum MonoDetector {
    static let measureSeconds = 120.0
    /// Mean energy per sample, on samples in -1..1.
    static let silentEnergy = 1e-10
    static let quietUnderLoudDb = 40.0
    static let minCorrelation = 0.999

    /// The server measures a two-channel 16-bit mix at this rate, so this does too: the
    /// rate drops uncorrelated high-frequency noise that would otherwise lower the correlation.
    static let measureSampleRate = 11_025.0
    static let fullScale = 32_768.0

    /// ``isMono(url:)`` off the caller's actor. Cancelling the calling task stops the decode.
    @concurrent
    public static func measure(url: URL) async throws -> Bool {
        try isMono(url: url)
    }

    /// Reads up to the first ``measureSeconds`` of `url`, mixed to two channels at
    /// ``measureSampleRate`` and rounded to 16-bit samples. A file is mono when it has one
    /// channel, when both channels' mean energy per sample is under ``silentEnergy``, when its
    /// quieter channel is more than ``quietUnderLoudDb`` under its louder one, or when the
    /// normalized correlation of its channels is at least ``minCorrelation``.
    public static func isMono(url: URL) throws -> Bool {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard format.channelCount > 1 else { return true }
        guard
            let target = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: measureSampleRate, channels: 2, interleaved: false),
            let converter = AVAudioConverter(from: format, to: target),
            let input = AVAudioPCMBuffer(
                pcmFormat: format, frameCapacity: AVAudioFrameCount(format.sampleRate.rounded())),
            let output = AVAudioPCMBuffer(
                pcmFormat: target, frameCapacity: AVAudioFrameCount(measureSampleRate) + 1024)
        else { throw CaptureError.unsupportedFormat }
        // Mixes surround channels into both sides, as the server's mix to two channels does.
        converter.downmix = true

        // Reading at the end of the file throws rather than returning no frames.
        var remaining = min(file.length, AVAudioFramePosition((measureSeconds * format.sampleRate).rounded()))
        var readError: (any Error)?
        var left: Int64 = 0
        var right: Int64 = 0
        var cross: Int64 = 0
        var frames = 0
        while true {
            try Task.checkCancellation()
            output.frameLength = 0
            var failure: NSError?
            let status = converter.convert(to: output, error: &failure) { _, inputStatus in
                guard remaining > 0 else {
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                do {
                    try file.read(
                        into: input,
                        frameCount: AVAudioFrameCount(min(AVAudioFramePosition(input.frameCapacity), remaining)))
                } catch {
                    readError = error
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                guard input.frameLength > 0 else {
                    remaining = 0
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                remaining -= AVAudioFramePosition(input.frameLength)
                inputStatus.pointee = .haveData
                return input
            }
            if let readError { throw readError }
            if status == .error { throw failure ?? CaptureError.unsupportedFormat }
            guard let channels = output.floatChannelData else { throw CaptureError.unsupportedFormat }
            for i in 0..<Int(output.frameLength) {
                let l = sample16(channels[0][i])
                let r = sample16(channels[1][i])
                left += l * l
                right += r * r
                cross += l * r
            }
            frames += Int(output.frameLength)
            if status == .endOfStream || status == .inputRanDry { break }
        }
        let scale = fullScale * fullScale
        return isMono(
            left: Double(left) / scale, right: Double(right) / scale, cross: Double(cross) / scale, frames: frames)
    }

    /// Rounds a -1..1 sample to signed 16-bit, clipping as the server's decoder does.
    private static func sample16(_ x: Float) -> Int64 {
        Int64(min(max((Double(x) * fullScale).rounded(.toNearestOrEven), -fullScale), fullScale - 1))
    }

    static func isMono(left: Double, right: Double, cross: Double, frames: Int) -> Bool {
        let louder = max(left, right)
        if frames == 0 || louder / Double(frames) < silentEnergy { return true }
        let quieter = min(left, right)
        if quieter < louder * pow(10, -quietUnderLoudDb / 10) { return true }
        // Both channels hold energy past the checks above, so the root is never zero.
        return cross / (left * right).squareRoot() >= minCorrelation
    }
}
