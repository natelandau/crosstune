import CrosstuneStore

/// A stretch of the recording the overview strip draws as a band, in ms from the trim start.
struct OverviewBand: Equatable {
    let startMs: Int64
    let endMs: Int64
    /// The loop color slot.
    let color: Int
    let selected: Bool
}

/// What the overview strip draws and where a tap on it goes. Every value in ms counts from the
/// trim start.
@MainActor
protocol OverviewSource: AnyObject {
    /// The trimmed recording's length, 0 until it is known.
    var overviewLengthMs: Int64 { get }
    var overviewPlayheadMs: Int64 { get }
    var overviewBands: [OverviewBand] { get }
    /// Where a line crosses the strip at each cut.
    var overviewCutsMs: [Int64] { get }
    /// The stretch the zoomed waveform shows, boxed on the strip.
    var overviewZoomedView: ZoomedWaveformView? { get }
    /// Whether the playhead moves on a clock of its own, which the strip follows frame by frame.
    var overviewAnimates: Bool { get }
    /// Moves the playhead to `fraction` of the strip's width.
    func overviewSeek(toFraction fraction: Double)
}

extension PracticeModel: OverviewSource {
    var overviewLengthMs: Int64 { lengthMs }
    var overviewPlayheadMs: Int64 { centerMs }
    var overviewBands: [OverviewBand] {
        let selected = selectedID
        return placedLoops.map {
            OverviewBand(
                startMs: $0.span.startMs - trimStartMs, endMs: $0.span.endMs - trimStartMs, color: $0.color,
                selected: $0.id == selected)
        }
    }
    var overviewCutsMs: [Int64] { [] }
    var overviewZoomedView: ZoomedWaveformView? { zoomedWaveformView }
    var overviewAnimates: Bool { momentumScroll != nil }

    func overviewSeek(toFraction fraction: Double) {
        guard lengthMs > 0 else { return }
        seek(toMs: Int64((fraction * Double(lengthMs)).rounded()))
    }
}

extension SplitModel: OverviewSource {
    var overviewLengthMs: Int64 { bounds.upperBound - bounds.lowerBound }
    var overviewPlayheadMs: Int64 { shownLineMs - bounds.lowerBound }
    /// The pieces in loop colors, the selected piece, else the one holding the line, selected.
    /// One piece is the whole recording, which needs no band.
    var overviewBands: [OverviewBand] {
        guard !state.cuts.isEmpty else { return [] }
        let low = bounds.lowerBound
        let current = selectedPiece ?? state.pieceIndex(at: shownLineMs)
        return state.pieces.enumerated().map { index, piece in
            OverviewBand(
                startMs: piece.startMs - low, endMs: piece.endMs - low, color: State.pieceColor(index),
                selected: index == current)
        }
    }
    var overviewCutsMs: [Int64] { state.cuts.map { $0 - bounds.lowerBound } }
    var overviewZoomedView: ZoomedWaveformView? { zoomedView(centerMs: shownLineMs) }
    var overviewAnimates: Bool { false }

    func overviewSeek(toFraction fraction: Double) {
        let span = Double(bounds.upperBound - bounds.lowerBound)
        seek(to: bounds.lowerBound + Int64((min(max(fraction, 0), 1) * span).rounded()))
    }
}
