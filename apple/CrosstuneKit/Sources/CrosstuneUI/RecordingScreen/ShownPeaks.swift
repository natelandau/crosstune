import CrosstuneAudio
import CrosstuneStore
import SwiftUI

/// The waveform of a recording's trimmed range, or nil when the peaks on hand do not line up
/// with it.
struct ShownPeaks: Equatable {
    let peaks: Peaks
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
        self.peaks = peaks.sliced(fromMs: startMs, toMs: max(startMs, endMs))
        loudest = peaks.values.max() ?? 0
    }

    private init(peaks: Peaks, loudest: UInt8) {
        self.peaks = peaks
        self.loudest = loudest
    }

    /// The points from `fromMs` to `toMs` into these, scaled to the same loudest point.
    func sliced(fromMs: Int64, toMs: Int64) -> ShownPeaks {
        ShownPeaks(peaks: peaks.sliced(fromMs: fromMs, toMs: toMs), loudest: loudest)
    }

    /// The loudest value in each of `count` equal runs of points, as a share of ``loudest``.
    func bars(_ count: Int) -> [CGFloat] {
        let values = peaks.values
        guard count > 0, !values.isEmpty, loudest > 0 else { return [] }
        return (0..<count).map { bar in
            let start = bar * values.count / count
            let end = max(start + 1, (bar + 1) * values.count / count)
            let peak = values[start..<min(end, values.count)].max() ?? 0
            return CGFloat(peak) / CGFloat(loudest)
        }
    }
}
