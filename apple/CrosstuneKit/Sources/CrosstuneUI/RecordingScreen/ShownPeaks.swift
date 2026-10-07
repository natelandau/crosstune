import CrosstuneAudio
import CrosstuneStore
import SwiftUI

/// The waveform of a recording's trimmed range, or nil when the peaks on hand do not line up
/// with it.
struct ShownPeaks: Equatable {
    /// The points shown, a window into one buffer that every slice of these shares, so slicing
    /// on each frame copies nothing.
    let values: ArraySlice<UInt8>
    let pointsPerSecond: Int
    /// The loudest point in the whole peaks file, which the bars scale to, so a trim does not
    /// change how loud the rest looks.
    let loudest: UInt8

    /// - Parameter peaksRev: The revision of the server's waveform `peaks` is, or nil for peaks
    ///   made on this device while recording. Those cover the whole source from its start; the
    ///   server's cover its playback file, which starts at the row's `playbackStartMs`, and only
    ///   for the revision the row names.
    init?(_ recording: Recording, peaks: Peaks?, peaksRev: String?) {
        guard let peaks else { return nil }
        if let peaksRev, peaksRev != recording.peaksRev { return nil }
        let fileStartMs = peaksRev == nil ? 0 : (recording.playbackStartMs ?? 0)
        let fileLengthMs = Int64(peaks.values.count) * 1000 / Int64(max(1, peaks.pointsPerSecond))
        let startMs = max(0, recording.trimStartMs - fileStartMs)
        let endMs = recording.trimEndMs.map { $0 - fileStartMs } ?? fileLengthMs
        self.init(
            values: peaks.values[...], pointsPerSecond: peaks.pointsPerSecond, loudest: peaks.values.max() ?? 0)
        self = sliced(fromMs: startMs, toMs: max(startMs, endMs))
    }

    private init(values: ArraySlice<UInt8>, pointsPerSecond: Int, loudest: UInt8) {
        self.values = values
        self.pointsPerSecond = pointsPerSecond
        self.loudest = loudest
    }

    /// The points from `fromMs` to `toMs` into these, offsets floored to point indices, scaled
    /// to the same loudest point.
    func sliced(fromMs: Int64, toMs: Int64) -> ShownPeaks {
        let start = values.startIndex + offset(fromMs)
        let end = values.startIndex + offset(toMs)
        return ShownPeaks(
            values: start < end ? values[start..<end] : [], pointsPerSecond: pointsPerSecond, loudest: loudest)
    }

    private func offset(_ ms: Int64) -> Int {
        min(max(Int(ms) * pointsPerSecond / 1000, 0), values.count)
    }

    /// The loudest value in each of `count` equal runs of points, as a share of ``loudest``.
    func bars(_ count: Int) -> [CGFloat] {
        let total = values.count
        guard count > 0, total > 0, loudest > 0 else { return [] }
        let base = values.startIndex
        return (0..<count).map { bar in
            let start = bar * total / count
            let end = max(start + 1, (bar + 1) * total / count)
            let peak = values[(base + start)..<(base + min(end, total))].max() ?? 0
            return CGFloat(peak) / CGFloat(loudest)
        }
    }
}
