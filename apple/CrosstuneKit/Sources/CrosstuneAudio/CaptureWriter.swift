@preconcurrency import AVFoundation
import Foundation

/// Encodes microphone buffers to a mono 48 kHz AAC file as they arrive.
///
/// Buffers in any input format are converted first, so a route change to a microphone with a
/// different rate or channel count keeps writing the same file. Safe to call from the audio
/// tap's thread while the main actor reads ``duration`` or closes the file.
public final class CaptureWriter: @unchecked Sendable {
    public static let sampleRate = 48_000.0

    private let lock = NSLock()
    private var file: AVAudioFile?
    private let format: AVAudioFormat
    private var converter: AVAudioConverter?
    /// Reused from buffer to buffer, since the file copies what it is given before `write`
    /// returns.
    private var output: AVAudioPCMBuffer?
    private let url: URL
    private var secondsWritten: TimeInterval = 0

    /// Creates the file at `url`, replacing any file already there.
    public init(url: URL, bitrate: Int) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: Self.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: bitrate,
        ]
        let file = try AVAudioFile(
            forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        self.file = file
        self.url = url
        format = file.processingFormat
    }

    /// Seconds of input written so far, counted from the input so a resampler's buffering
    /// never makes the clock lag.
    public var duration: TimeInterval {
        lock.withLock { secondsWritten }
    }

    /// The size of the file on disk so far.
    public var bytesWritten: Int64 {
        (try? CaptureFiles.size(of: url)) ?? 0
    }

    /// Appends a buffer. After ``close()`` this does nothing.
    public func write(_ buffer: AVAudioPCMBuffer) throws {
        try lock.withLock {
            guard let file, buffer.frameLength > 0 else { return }
            let output = try converted(buffer)
            try file.write(from: output)
            secondsWritten += Double(buffer.frameLength) / buffer.format.sampleRate
        }
    }

    /// Flushes the encoder and closes the file.
    public func close() {
        lock.withLock {
            file?.close()
            file = nil
            converter = nil
            output = nil
        }
    }

    private func converted(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer {
        if buffer.format == format { return buffer }
        if converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: format)
            // A stereo interface records both channels into the one mono track instead of
            // dropping the right.
            converter?.downmix = true
        }
        guard let converter else { throw CaptureError.unsupportedFormat }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
        if output.map({ $0.frameCapacity < capacity }) ?? true {
            output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity)
        }
        guard let output else { throw CaptureError.unsupportedFormat }
        output.frameLength = 0
        var supplied = false
        var failure: NSError?
        let status = converter.convert(to: output, error: &failure) { _, inputStatus in
            // The converter keeps its resampler state between calls, so saying "no data now"
            // rather than "end of stream" lets the next buffer continue the same signal.
            if supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        if status == .error { throw failure ?? CaptureError.unsupportedFormat }
        return output
    }
}

/// Why a capture could not be written or finished.
public enum CaptureError: Error, Equatable {
    /// The microphone delivered audio this device cannot convert to the capture format.
    case unsupportedFormat
}
