@preconcurrency import AVFoundation
import CrosstuneStore
import Foundation

/// The waveform peaks file: one byte per 20 ms window, the amplitude both clients draw.
///
/// Byte 0 is the format version, bytes 1-2 the points-per-second header field big-endian, then
/// one byte per window, each the window's loudest sample scaled to 0-255 at full scale. Must
/// match the server's and the web client's format exactly, since a peaks file made by any of the
/// three is read by all of them.
public struct Peaks: Equatable, Sendable {
    public static let version: UInt8 = 1
    public static let pointsPerSecond = 50
    static let headerSize = 3
    static let msPerWindow = 1000 / pointsPerSecond

    public let pointsPerSecond: Int
    public let values: [UInt8]

    public init(pointsPerSecond: Int = Peaks.pointsPerSecond, values: [UInt8]) {
        self.pointsPerSecond = pointsPerSecond
        self.values = values
    }

    /// Checks the header and keeps the raw per-window peak bytes.
    public init(file: Data) throws {
        guard file.count >= Self.headerSize else { throw PeaksError.invalidHeader }
        let bytes = [UInt8](file)
        let version = bytes[0]
        let pointsPerSecond = (Int(bytes[1]) << 8) | Int(bytes[2])
        guard version == Self.version, pointsPerSecond == Self.pointsPerSecond else {
            throw PeaksError.invalidHeader
        }
        self.pointsPerSecond = pointsPerSecond
        values = Array(bytes[Self.headerSize...])
    }

    /// Prefixes the raw per-window peak bytes with the format header.
    public func encoded() -> Data {
        var data = Data([Self.version, UInt8((pointsPerSecond >> 8) & 0xff), UInt8(pointsPerSecond & 0xff)])
        data.append(contentsOf: values)
        return data
    }

    /// Cuts this file down to the `fromMs` to `toMs` range of its own timeline, offsets floored
    /// to point indices.
    public func sliced(fromMs: Int64, toMs: Int64) -> Peaks {
        let start = clampedIndex(fromMs)
        let end = clampedIndex(toMs)
        guard start < end else { return Peaks(pointsPerSecond: pointsPerSecond, values: []) }
        return Peaks(pointsPerSecond: pointsPerSecond, values: Array(values[start..<end]))
    }

    private func clampedIndex(_ ms: Int64) -> Int {
        min(max(Int(ms) * pointsPerSecond / 1000, 0), values.count)
    }

    /// Resamples captured peak bytes to `round(durationMs / 20)` points, taking the max of each
    /// target window. Capture ticks drift from the ideal 20 ms cadence, so the raw count rarely
    /// lines up with the final duration.
    public static func fitted(_ values: [UInt8], durationMs: Int64) -> [UInt8] {
        let targetCount = Int((Double(durationMs) / Double(msPerWindow)).rounded())
        guard targetCount > 0 else { return [] }
        let total = values.count
        return (0..<targetCount).map { t in
            let start = t * total / targetCount
            let end = (t + 1) * total / targetCount
            return values[start..<end].max() ?? 0
        }
    }

    /// Decodes `url` to mono float PCM and reduces it to one peak byte per 20 ms window, for a
    /// file this device never recorded itself, such as an import or a crash-recovered capture.
    public static func read(from url: URL) async throws -> Peaks {
        try await decode(url, onStart: nil)
    }

    /// Runs the blocking read loop below. `copyNextSampleBuffer()` holds its thread until
    /// CoreMedia delivers, so the loop never runs on Swift's cooperative pool: a few decodes at
    /// once would hold every pool thread on a machine with few cores, and the file reads they
    /// wait on would never be scheduled.
    private static let readQueue = DispatchQueue(
        label: "crosstune.peaks.read", qos: .utility, attributes: .concurrent)

    /// The decode itself, on ``readQueue`` rather than the caller's actor or the cooperative pool.
    /// `onStart` is a test seam that observes the thread it actually runs on.
    static func decode(_ url: URL, onStart: (@Sendable () -> Void)?) async throws -> Peaks {
        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
            throw PeaksError.noAudioTrack
        }
        return try await withCheckedThrowingContinuation { continuation in
            readQueue.async {
                onStart?()
                continuation.resume(with: Result { try readPeaks(of: track, in: asset) })
            }
        }
    }

    /// Reads `track` to the end as mono float PCM, one peak byte per 20 ms window. Blocks its
    /// thread for the whole decode.
    private static func readPeaks(of track: AVAssetTrack, in asset: AVURLAsset) throws -> Peaks {
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(
            track: track,
            outputSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVLinearPCMBitDepthKey: 32,
                AVLinearPCMIsFloatKey: true,
                AVLinearPCMIsNonInterleaved: true,
                AVNumberOfChannelsKey: 1,
            ])
        reader.add(output)
        guard reader.startReading() else { throw PeaksError.readFailed }
        var meter = PeakMeter()
        var values: [UInt8] = []
        while let sampleBuffer = output.copyNextSampleBuffer() {
            if let buffer = try pcmBuffer(from: sampleBuffer) {
                values.append(contentsOf: meter.peaks(of: buffer))
            }
        }
        guard reader.status == .completed else { throw PeaksError.readFailed }
        return Peaks(pointsPerSecond: Self.pointsPerSecond, values: values)
    }

    /// Copies one decoded sample buffer into a PCM buffer ``PeakMeter`` can measure.
    private static func pcmBuffer(from sampleBuffer: CMSampleBuffer) throws -> AVAudioPCMBuffer? {
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
            let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription),
            let format = AVAudioFormat(streamDescription: asbd)
        else { return nil }
        let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frameCount > 0,
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frameCount))
        else { return nil }
        buffer.frameLength = AVAudioFrameCount(frameCount)
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer, at: 0, frameCount: Int32(frameCount), into: buffer.mutableAudioBufferList)
        guard status == noErr else { throw PeaksError.readFailed }
        return buffer
    }

    /// Scales a window's loudest sample magnitude to a byte, 0 to 255 at full scale.
    static func byte(from peak: Float) -> UInt8 {
        UInt8((min(max(peak, 0), 1) * 255).rounded())
    }
}

extension Peaks {
    /// Writes this waveform beside `recordingID`'s audio in `store`'s folder and returns its
    /// file name.
    public func write(for recordingID: String, in store: CrosstuneStore) throws -> String {
        let name = CaptureFiles.peaksName(recordingID)
        try encoded().write(to: store.audioFolder.appending(path: name), options: .atomic)
        return name
    }
}

/// Why a peaks file could not be parsed, or an audio file could not be measured for one.
public enum PeaksError: Error, Equatable {
    /// `data`'s header names a different version or points-per-second than this format.
    case invalidHeader
    case noAudioTrack
    case readFailed
}
