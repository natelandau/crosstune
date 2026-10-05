import CrosstuneStore
import SwiftUI

/// The whole trimmed recording, every loop as a band beneath it, the playhead, and a box around
/// the stretch the waveform shows. A tap moves the playhead there and a drag carries it along.
/// Touch and pointer only: the waveform's own adjustable value is the way to the same places
/// otherwise. Until the recording's length is known, a plain timeline bar stands in.
struct OverviewStrip: View {
    let model: PracticeModel
    let peaks: ShownPeaks?

    @Environment(\.colorScheme) private var colorScheme
    @State private var width: Double = 0

    private static let waveHeight: CGFloat = 24
    private static let bandHeight: CGFloat = 6

    var body: some View {
        Canvas { context, size in
            draw(in: &context, size: size)
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
            context.fillPeakBars(nil, in: wave, style: .tertiary)
            return
        }
        func x(_ trimmedMs: Double) -> CGFloat { CGFloat(trimmedMs / length) * size.width }
        context.fillPeakBars(peaks, in: wave, style: .tertiary)
        let selected = model.selectedID
        for loop in model.placedLoops {
            let x0 = x(Double(loop.span.startMs - model.trimStartMs))
            let x1 = x(Double(loop.span.endMs - model.trimStartMs))
            let band = CGRect(x: x0, y: size.height - Self.bandHeight, width: max(2, x1 - x0), height: Self.bandHeight)
            context.fill(
                Path(roundedRect: band, cornerRadius: Self.bandHeight / 2),
                with: .color(LoopColor.color(loop.color, scheme: colorScheme).opacity(loop.id == selected ? 1 : 0.6)))
        }
        let playhead = x(Double(model.centerMs))
        context.fillPlayhead(
            CGRect(x: min(max(0, playhead - 1), size.width - 2), y: 0, width: 2, height: Self.waveHeight))
        if let view = model.laneView {
            let box = CGRect(
                x: x(view.startMs), y: 1, width: x(view.endMs) - x(view.startMs), height: Self.waveHeight - 2)
            context.stroke(Path(roundedRect: box, cornerRadius: 4), with: .style(.tint), lineWidth: 2)
        }
    }
}
