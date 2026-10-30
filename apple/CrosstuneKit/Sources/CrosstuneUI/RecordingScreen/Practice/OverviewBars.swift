import Foundation

/// The overview strip's bars, kept for one width and one set of peaks, so a playback frame
/// redraws them without rebuilding them from every point of the recording.
@MainActor
final class OverviewBars {
    private struct Source: Equatable {
        let peaks: ShownPeaks?
        let count: Int
    }

    private var source: Source?
    private var levels: [CGFloat] = []

    /// `count` bars of `peaks`, or none without peaks to draw.
    func levels(_ peaks: ShownPeaks?, count: Int) -> [CGFloat] {
        let now = Source(peaks: peaks, count: count)
        if now != source {
            source = now
            levels = peaks?.bars(count) ?? []
        }
        return levels
    }
}
