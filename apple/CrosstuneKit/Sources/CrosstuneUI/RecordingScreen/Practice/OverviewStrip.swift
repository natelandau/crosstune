import CrosstuneStore
import SwiftUI

/// The whole trimmed recording, every loop as a band beneath it, the playhead, and a box around
/// the zoomed stretch. A tap moves the zoomed view there and a drag carries it along. Touch and
/// pointer only: the zoom buttons and the handles are the way to the same places otherwise.
struct OverviewStrip: View {
    let model: PracticeModel
    let peaks: ShownPeaks?

    @Environment(\.colorScheme) private var colorScheme
    /// Where the drag under way last was.
    @State private var lastX: Double?
    /// True once a drag has turned out to run mostly up or down, which scrolls the screen.
    @State private var isScrolling = false

    private static let dragThreshold: CGFloat = 4
    private static let waveHeight: CGFloat = 24
    private static let bandHeight: CGFloat = 6

    var body: some View {
        Canvas { context, size in
            draw(in: &context, size: size)
        }
        .frame(height: Self.waveHeight + Self.bandHeight + 2)
        .contentShape(.rect)
        .onTapGesture { location in press(at: Double(location.x)) }
        // Alongside the screen's scrolling: a drag that starts mostly vertical scrolls instead.
        .simultaneousGesture(
            DragGesture(minimumDistance: Self.dragThreshold)
                .onChanged { value in
                    if lastX == nil && !isScrolling {
                        guard abs(value.translation.width) >= abs(value.translation.height) else {
                            isScrolling = true
                            return
                        }
                        press(at: Double(value.startLocation.x))
                        lastX = Double(value.startLocation.x)
                    }
                    guard let last = lastX else { return }
                    let x = Double(value.location.x)
                    model.pan(byMs: (x - last) * msPerPoint)
                    lastX = x
                }
                .onEnded { _ in
                    lastX = nil
                    isScrolling = false
                }
        )
        .accessibilityHidden(true)
    }

    private var msPerPoint: Double {
        model.width > 0 ? Double(model.lengthMs) / model.width : 0
    }

    /// A press inside the box carries it from where it was taken; anywhere else first brings the
    /// box to the press.
    private func press(at x: Double) {
        guard let shown = model.currentZoom?.visibleSpan(width: model.width) else { return }
        let ms = x * msPerPoint
        if ms < shown.startMs || ms > shown.endMs { model.center(onMs: ms) }
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let length = Double(model.lengthMs)
        guard length > 0 else { return }
        func x(_ trimmedMs: Double) -> CGFloat { CGFloat(trimmedMs / length) * size.width }
        context.fillPeakBars(
            peaks, in: CGRect(x: 0, y: 0, width: size.width, height: Self.waveHeight), style: .tertiary)
        let selected = model.selectedID
        for loop in model.laneLoops where !loop.isNew {
            let x0 = x(Double(loop.span.startMs - model.trimStartMs))
            let x1 = x(Double(loop.span.endMs - model.trimStartMs))
            let band = CGRect(x: x0, y: size.height - Self.bandHeight, width: max(2, x1 - x0), height: Self.bandHeight)
            context.fill(
                Path(roundedRect: band, cornerRadius: Self.bandHeight / 2),
                with: .color(LoopColor.color(loop.color, scheme: colorScheme).opacity(loop.id == selected ? 1 : 0.6)))
        }
        let playhead = x(model.positionMs)
        context.fill(
            Path(CGRect(x: min(max(0, playhead - 1), size.width - 2), y: 0, width: 2, height: Self.waveHeight)),
            with: .style(.primary))
        if let shown = model.currentZoom?.visibleSpan(width: model.width) {
            let box = CGRect(
                x: x(shown.startMs), y: 1, width: x(shown.endMs) - x(shown.startMs), height: Self.waveHeight - 2)
            context.stroke(Path(roundedRect: box, cornerRadius: 4), with: .style(.tint), lineWidth: 2)
        }
    }
}
