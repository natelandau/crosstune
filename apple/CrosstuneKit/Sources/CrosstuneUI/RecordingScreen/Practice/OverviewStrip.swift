import CrosstuneStore
import SwiftUI

/// The whole trimmed recording, every loop as a band beneath it, the playhead, and a box around
/// the stretch the waveform shows. A tap moves the playhead there and a drag carries it along.
/// Touch and pointer only: the waveform's own adjustable value is the way to the same places
/// otherwise. Until the recording's length is known, a plain timeline bar shows instead.
struct OverviewStrip: View {
    let model: PracticeModel
    let peaks: ShownPeaks?

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.practiceBackground) private var practiceScheme
    @State private var width: Double = 0

    private static let waveHeight: CGFloat = 24
    private static let bandHeight: CGFloat = 6

    var body: some View {
        // A momentum scroll's playhead comes from the clock, so the strip follows it frame by frame.
        TimelineView(.animation(paused: model.momentumScroll == nil)) { _ in
            Canvas { context, size in
                draw(in: &context, size: size)
            }
        }
        .frame(height: Self.waveHeight + Self.bandHeight + 2)
        .contentShape(.rect)
        .onGeometryChange(for: Double.self) {
            Double($0.size.width)
        } action: {
            width = $0
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in seek(atX: Double(value.location.x)) }
        )
        .accessibilityHidden(true)
    }

    private func seek(atX x: Double) {
        guard width > 0, model.lengthMs > 0 else { return }
        model.seek(toMs: Int64((x / width * Double(model.lengthMs)).rounded()))
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let wave = CGRect(x: 0, y: 0, width: size.width, height: Self.waveHeight)
        let length = Double(model.lengthMs)
        guard length > 0 else {
            #if os(macOS)
                context.fill(.peakBars(nil, in: wave), with: .color(MacWave.placeholder))
            #else
                context.fill(.peakBars(nil, in: wave), with: .quietBars(onPractice: practiceScheme != nil))
            #endif
            return
        }
        func x(_ trimmedMs: Double) -> CGFloat { CGFloat(trimmedMs / length) * size.width }
        #if os(macOS)
            let levels = peaks?.bars(PeakBars.count(in: wave.width)) ?? []
            if levels.isEmpty {
                context.fill(.peakBars(nil, in: wave), with: .color(MacWave.placeholder))
            } else {
                context.fillSplit(
                    .peakBars(levels: levels, in: wave), atX: Double(x(Double(model.centerMs))),
                    played: MacWave.played, unplayed: MacWave.unplayed)
            }
        #else
            context.fill(.peakBars(peaks, in: wave), with: .quietBars(onPractice: practiceScheme != nil))
        #endif
        let selected = model.selectedID
        for loop in model.placedLoops {
            let x0 = x(Double(loop.span.startMs - model.trimStartMs))
            let x1 = x(Double(loop.span.endMs - model.trimStartMs))
            let band = CGRect(x: x0, y: size.height - Self.bandHeight, width: max(2, x1 - x0), height: Self.bandHeight)
            context.fill(
                Path(roundedRect: band, cornerRadius: Self.bandHeight / 2),
                with: .color(Palette.loop(loop.color, scheme: colorScheme).opacity(loop.id == selected ? 1 : 0.6)))
        }
        let playhead = x(Double(model.centerMs))
        context.fillPlayhead(
            CGRect(x: min(max(0, playhead - 1), size.width - 2), y: 0, width: 2, height: Self.waveHeight),
            onPractice: practiceScheme != nil)
        if let view = model.zoomedWaveformView {
            let box = CGRect(
                x: x(view.startMs), y: 1, width: x(view.endMs) - x(view.startMs), height: Self.waveHeight - 2)
            #if os(macOS)
                let frame = Path(roundedRect: box.insetBy(dx: 0.5, dy: 0.5), cornerRadius: 4)
                context.fill(frame, with: .color(Palette.accent.opacity(0.12)))
                context.stroke(frame, with: .color(Palette.accent), lineWidth: 1)
            #else
                context.stroke(Path(roundedRect: box, cornerRadius: 4), with: .style(.tint), lineWidth: 2)
            #endif
        }
    }
}
