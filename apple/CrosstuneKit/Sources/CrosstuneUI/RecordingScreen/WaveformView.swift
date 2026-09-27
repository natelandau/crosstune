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

/// The whole trimmed recording drawn as its waveform, which is also the scrubber: tap or drag
/// anywhere to move there. A plain bar stands in when there are no peaks to draw.
struct WaveformView: View {
    let peaks: ShownPeaks?
    /// The trimmed recording's length in seconds.
    let length: TimeInterval
    let position: TimeInterval
    let onSeek: (TimeInterval) -> Void

    /// Where a drag under way points; playback moves once it is let go.
    @State private var dragged: TimeInterval?
    @Environment(\.isEnabled) private var isEnabled

    private static let height: CGFloat = 96
    private static let barWidth: CGFloat = 2
    private static let barGap: CGFloat = 1
    private static let minimumBar: CGFloat = 2
    private static let dragThreshold: CGFloat = 8
    /// How far one VoiceOver swipe moves.
    static let accessibilityStep: TimeInterval = 5

    var body: some View {
        let shown = dragged ?? position
        GeometryReader { geometry in
            Canvas { context, size in
                draw(in: &context, size: size, playedTo: fraction(shown))
            }
            .contentShape(.rect)
            .onTapGesture { location in
                guard isEnabled else { return }
                onSeek(time(at: location.x, width: geometry.size.width))
            }
            // Alongside the screen's scrolling rather than in its place: a drag that starts
            // mostly vertical is a scroll and leaves the playhead alone.
            .simultaneousGesture(
                DragGesture(minimumDistance: Self.dragThreshold)
                    .onChanged { value in
                        guard
                            dragged != nil || abs(value.translation.width) > abs(value.translation.height)
                        else { return }
                        dragged = time(at: value.location.x, width: geometry.size.width)
                    }
                    .onEnded { value in
                        guard dragged != nil else { return }
                        onSeek(time(at: value.location.x, width: geometry.size.width))
                        dragged = nil
                    },
                including: isEnabled ? .all : .none)
        }
        .frame(height: Self.height)
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityElement()
        .accessibilityLabel(RecordingPlayerText.position)
        .accessibilityValue(PlayerTime.spoken(shown, of: length))
        .accessibilityAdjustableAction { direction in
            guard isEnabled else { return }
            switch direction {
            case .increment: onSeek(min(length, position + Self.accessibilityStep))
            case .decrement: onSeek(max(0, position - Self.accessibilityStep))
            @unknown default: break
            }
        }
    }

    private func fraction(_ time: TimeInterval) -> CGFloat {
        guard length > 0 else { return 0 }
        return CGFloat(min(max(time / length, 0), 1))
    }

    private func time(at x: CGFloat, width: CGFloat) -> TimeInterval {
        guard width > 0 else { return 0 }
        return length * TimeInterval(min(max(x / width, 0), 1))
    }

    private func draw(in context: inout GraphicsContext, size: CGSize, playedTo played: CGFloat) {
        let playedX = size.width * played
        let step = Self.barWidth + Self.barGap
        let levels = peaks?.bars(Int(size.width / step)) ?? []
        var ahead = Path()
        var behind = Path()
        if levels.isEmpty {
            let line = CGRect(x: 0, y: (size.height - 4) / 2, width: size.width, height: 4)
            ahead.addRoundedRect(in: line, cornerSize: CGSize(width: 2, height: 2))
            behind.addRoundedRect(
                in: CGRect(x: 0, y: line.minY, width: playedX, height: line.height),
                cornerSize: CGSize(width: 2, height: 2))
        } else {
            for (index, level) in levels.enumerated() {
                let bar = max(Self.minimumBar, level * size.height)
                let rect = CGRect(
                    x: CGFloat(index) * step, y: (size.height - bar) / 2, width: Self.barWidth, height: bar)
                if rect.midX < playedX {
                    behind.addRoundedRect(in: rect, cornerSize: CGSize(width: 1, height: 1))
                } else {
                    ahead.addRoundedRect(in: rect, cornerSize: CGSize(width: 1, height: 1))
                }
            }
        }
        context.fill(ahead, with: .style(.tertiary))
        context.fill(behind, with: .style(.tint))
        // The playhead, so the place shows even between bars.
        context.fill(
            Path(CGRect(x: min(max(0, playedX - 1), size.width - 2), y: 0, width: 2, height: size.height)),
            with: .style(.primary))
    }
}
