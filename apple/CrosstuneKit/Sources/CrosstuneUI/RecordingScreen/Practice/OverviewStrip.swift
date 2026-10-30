import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// The whole trimmed recording, a band beneath it for each of its source's stretches, a line at
/// each cut, the playhead, and a box around the stretch the zoomed waveform shows. A tap moves
/// the playhead there and a drag carries it along, over `header` too. Touch and pointer only:
/// the zoomed waveform's own adjustable value is the way to the same places otherwise. Until the
/// recording's length is known, a plain timeline bar shows instead.
struct OverviewStrip<Source: OverviewSource, Header: View>: View {
    /// Practice's loops, or Split's pieces.
    enum Style {
        case practice
        case split
    }

    let source: Source
    let peaks: ShownPeaks?
    let style: Style
    let header: Header

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.practiceBackground) private var practiceScheme
    @Environment(\.isEnabled) private var isEnabled
    @State private var width: Double = 0
    @State private var bars = OverviewBars()

    private static var bandHeight: CGFloat { 6 }

    init(source: Source, peaks: ShownPeaks?, style: Style = .practice, @ContentBuilder header: () -> Header) {
        self.source = source
        self.peaks = peaks
        self.style = style
        self.header = header()
    }

    private var waveHeight: CGFloat { style == .practice ? 24 : 40 }

    var body: some View {
        VStack(spacing: 2) {
            header
            // A momentum scroll's playhead comes from the clock, so the strip follows it frame by frame.
            TimelineView(.animation(paused: !source.overviewAnimates)) { _ in
                Canvas { context, size in
                    draw(in: &context, size: size)
                }
            }
            .frame(height: waveHeight + Self.bandHeight + 2)
        }
        .contentShape(.rect)
        .onGeometryChange(for: Double.self) {
            Double($0.size.width)
        } action: {
            width = $0
        }
        .gesture(
            DragGesture(minimumDistance: 0).onChanged { value in
                guard width > 0 else { return }
                source.overviewSeek(toFraction: Double(value.location.x) / width)
            },
            including: isEnabled ? .all : .none
        )
        .accessibilityHidden(true)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let wave = CGRect(x: 0, y: 0, width: size.width, height: waveHeight)
        let onPractice = practiceScheme != nil
        let length = Double(source.overviewLengthMs)
        let levels = bars.levels(peaks, count: PeakBars.count(in: wave.width))
        guard length > 0 else {
            #if os(macOS)
                context.fill(
                    .peakBars(levels: PeakBars.placeholder(PeakBars.count(in: wave.width)), in: wave),
                    with: .color(MacWave.placeholder))
            #else
                context.fill(.peakBars(levels: [], in: wave), with: .quietBars(onPractice: onPractice))
            #endif
            return
        }
        func x(_ trimmedMs: Double) -> CGFloat { CGFloat(trimmedMs / length) * size.width }
        let playheadX = x(Double(source.overviewPlayheadMs))
        #if os(macOS)
            if levels.isEmpty {
                context.fill(
                    .peakBars(levels: PeakBars.placeholder(PeakBars.count(in: wave.width)), in: wave),
                    with: .color(MacWave.placeholder))
            } else if style == .practice {
                context.fillSplit(
                    .peakBars(levels: levels, in: wave), atX: Double(playheadX), played: MacWave.played,
                    unplayed: MacWave.unplayed)
            } else {
                context.fill(.peakBars(levels: levels, in: wave), with: .color(MacWave.unplayed))
            }
        #else
            context.fill(.peakBars(levels: levels, in: wave), with: .quietBars(onPractice: onPractice))
        #endif
        for band in source.overviewBands {
            let x0 = x(Double(band.startMs))
            let rect = CGRect(
                x: x0, y: size.height - Self.bandHeight, width: max(2, x(Double(band.endMs)) - x0),
                height: Self.bandHeight)
            // A piece's band meets the next; a loop's stands apart.
            let path = style == .practice ? Path(roundedRect: rect, cornerRadius: Self.bandHeight / 2) : Path(rect)
            context.fill(
                path, with: .color(Palette.loopOverview(band.color, scheme: colorScheme, selected: band.selected)))
        }
        let cutColor: GraphicsContext.Shading = onPractice ? .color(Palette.onPractice) : .style(.textPrimary)
        for cut in source.overviewCutsMs {
            let cutX = x(Double(cut))
            // The gap that sets a cut off its waveform would erase the bands, so the line crosses
            // the bands without one.
            context.fillCutLine(CGRect(x: cutX - 1, y: 0, width: 2, height: waveHeight), with: cutColor)
            context.fill(
                Path(CGRect(x: cutX - 1, y: waveHeight, width: 2, height: size.height - waveHeight)), with: cutColor)
        }
        context.fillPlayhead(
            CGRect(x: min(max(0, playheadX - 1), size.width - 2), y: 0, width: 2, height: waveHeight),
            onPractice: onPractice)
        if let view = source.overviewZoomedView {
            drawZoomBox(in: &context, from: x(view.startMs), to: x(view.endMs), width: size.width)
        }
    }

    private func drawZoomBox(in context: inout GraphicsContext, from: CGFloat, to: CGFloat, width: CGFloat) {
        switch style {
        case .practice:
            let box = CGRect(x: from, y: 1, width: to - from, height: waveHeight - 2)
            #if os(macOS)
                let frame = Path(roundedRect: box.insetBy(dx: 0.5, dy: 0.5), cornerRadius: 4)
                context.fill(frame, with: .color(Palette.tint(colorScheme)))
                context.stroke(frame, with: .color(Palette.accent), lineWidth: 1)
            #else
                context.stroke(Path(roundedRect: box, cornerRadius: 4), with: .style(.tint), lineWidth: 2)
            #endif
        case .split:
            let from = max(0, from)
            let to = min(width, to)
            guard to > from else { return }
            context.stroke(
                Path(roundedRect: CGRect(x: from, y: 1, width: to - from, height: waveHeight - 2), cornerRadius: 4),
                with: .style(.tint), lineWidth: 2)
        }
    }
}

extension OverviewStrip where Header == EmptyView {
    init(source: Source, peaks: ShownPeaks?) {
        self.init(source: source, peaks: peaks, style: .practice) { EmptyView() }
    }
}
