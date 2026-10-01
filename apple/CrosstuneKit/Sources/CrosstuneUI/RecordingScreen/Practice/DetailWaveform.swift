import CrosstuneStore
import SwiftUI

/// The zoomed stretch of the recording, with a time ruler and the selected loop tinted through
/// it. A tap seeks, a sideways drag pans, and the selected loop's edges are handles that a drag,
/// the arrow keys, and VoiceOver move. Bars are drawn only for the stretch in view.
struct DetailWaveform: View {
    let model: PracticeModel
    let peaks: ShownPeaks?
    let height: CGFloat
    var focus: FocusState<PracticeFocus?>.Binding

    @Environment(\.colorScheme) private var colorScheme
    /// Where the pan under way last was, or nil while no pan is under way.
    @State private var panX: Double?
    /// True once a drag has turned out to run mostly up or down, which scrolls the screen.
    @State private var isScrolling = false
    /// Resets however a handle's drag ends, cancelled included, so it always lets go.
    @GestureState private var isDraggingHandle = false

    /// Tick spacings the ruler picks from, in ms.
    private static let tickSteps: [Double] = [
        100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000,
    ]
    /// The least room a ruler label gets.
    private static let minTickPoints: Double = 56
    private static let rulerHeight: CGFloat = 16
    /// A touch target around a thin line.
    private static let handleWidth: CGFloat = 44

    var body: some View {
        if let view = model.laneView {
            VStack(spacing: 4) {
                Canvas { context, size in
                    drawRuler(in: &context, size: size, view: view)
                }
                .frame(height: Self.rulerHeight)
                .accessibilityHidden(true)
                ZStack(alignment: .topLeading) {
                    surface(view)
                    if let row = model.selected, let span = model.shownSpan(row.id) {
                        ForEach([LoopModel.Edge.start, .end], id: \.self) { edge in
                            handle(
                                edge, at: view.x(ofSourceMs: Double(edge == .start ? span.startMs : span.endMs)),
                                color: row.color, view: view)
                        }
                    }
                }
                .frame(height: height)
                .coordinateSpace(.named(Self.space))
            }
            .onChange(of: isDraggingHandle) { _, dragging in
                if !dragging { model.cancelDrag() }
            }
        }
    }

    private func surface(_ view: LaneView) -> some View {
        Canvas { context, size in
            draw(in: &context, size: size, view: view)
        }
        .contentShape(.rect)
        .onTapGesture { location in
            let ms = view.startMs + Double(location.x) / view.pointsPerSecond * 1000
            model.player.audio.seek(to: min(Double(model.lengthMs), max(0, ms)) / 1000)
        }
        // Alongside the screen's scrolling: a drag that starts mostly vertical scrolls instead.
        .simultaneousGesture(
            DragGesture(minimumDistance: LoopModel.dragThreshold)
                .onChanged { value in
                    if panX == nil && !isScrolling {
                        guard abs(value.translation.width) >= abs(value.translation.height) else {
                            isScrolling = true
                            return
                        }
                        panX = Double(value.startLocation.x)
                    }
                    guard let last = panX else { return }
                    let x = Double(value.location.x)
                    model.pan(byMs: -(x - last) / view.pointsPerSecond * 1000)
                    panX = x
                }
                .onEnded { _ in
                    panX = nil
                    isScrolling = false
                }
        )
        .accessibilityHidden(true)
    }

    private func handle(_ edge: LoopModel.Edge, at x: Double, color: Int, view: LaneView) -> some View {
        let inView = x >= 0 && x <= view.width
        let name = edge == .start ? PracticeText.loopStart : PracticeText.loopEnd
        return HandleMark(edge: edge, color: LoopColor.color(color, scheme: colorScheme))
            .frame(width: Self.handleWidth, height: height)
            .contentShape(.rect)
            .position(x: min(max(x, 0), view.width), y: height / 2)
            .opacity(inView ? 1 : 0)
            .allowsHitTesting(inView)
            .highPriorityGesture(
                DragGesture(minimumDistance: LoopModel.dragThreshold, coordinateSpace: .named(Self.space))
                    .updating($isDraggingHandle) { _, dragging, _ in dragging = true }
                    .onChanged { value in
                        if model.gesture == nil { model.beginHandleDrag(edge) }
                        model.drag(toX: Double(value.location.x), snapping: PracticeLanes.snaps(model))
                    }
                    .onEnded { value in
                        model.endDrag(atX: Double(value.location.x), snapping: PracticeLanes.snaps(model))
                    }
            )
            .focusable()
            .focused(focus, equals: .handle(edge))
            .onChange(of: focus.wrappedValue == .handle(edge)) { _, focused in
                if focused && !inView, let row = model.selected {
                    model.reveal(edge == .start ? row.startMs : row.endMs)
                }
            }
            .accessibilityElement()
            .accessibilityLabel(name)
            .accessibilityValue(model.handleValue(edge))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: step(edge, by: PracticeModel.nudgeMs)
                case .decrement: step(edge, by: -PracticeModel.nudgeMs)
                @unknown default: break
                }
            }
            .accessibilityAction(named: PracticeText.laterBySecond) { step(edge, by: PracticeModel.largeNudgeMs) }
            .accessibilityAction(named: PracticeText.earlierBySecond) { step(edge, by: -PracticeModel.largeNudgeMs) }
    }

    /// One VoiceOver step: a gesture of its own, written at once.
    private func step(_ edge: LoopModel.Edge, by deltaMs: Int64) {
        model.nudge(edge, by: deltaMs)
        model.commitNudge()
    }

    private static let space = "detail"

    private func draw(in context: inout GraphicsContext, size: CGSize, view: LaneView) {
        let slice = peaks?.sliced(fromMs: Int64(max(0, view.startMs)), toMs: Int64(view.endMs.rounded(.up)))
        context.fillPeakBars(slice, in: CGRect(origin: .zero, size: size), style: .tertiary)
        if let row = model.selected, let span = model.shownSpan(row.id) {
            let x0 = max(0, view.x(ofSourceMs: Double(span.startMs)))
            let x1 = min(Double(size.width), view.x(ofSourceMs: Double(span.endMs)))
            if x1 > x0 {
                context.fill(
                    Path(CGRect(x: x0, y: 0, width: x1 - x0, height: Double(size.height))),
                    with: .color(LoopColor.tint(row.color, scheme: colorScheme)))
            }
        }
        if let band = model.markBand, model.selected == nil || model.isMarking {
            let x0 = max(0, view.x(ofSourceMs: Double(band.startMs)))
            let x1 = min(Double(size.width), view.x(ofSourceMs: Double(band.endMs)))
            if x1 > x0 {
                context.fill(
                    Path(CGRect(x: x0, y: 0, width: x1 - x0, height: Double(size.height))),
                    with: .style(.quaternary))
            }
        }
        let playhead = view.x(ofSourceMs: Double(model.playheadMs))
        if playhead >= 0 && playhead <= Double(size.width) {
            context.fill(
                Path(CGRect(x: min(max(0, playhead - 1), Double(size.width) - 2), y: 0, width: 2, height: size.height)),
                with: .style(.primary))
        }
    }

    private func drawRuler(in context: inout GraphicsContext, size: CGSize, view: LaneView) {
        let step =
            Self.tickSteps.first { $0 / 1000 * view.pointsPerSecond >= Self.minTickPoints } ?? 300_000
        var tick = (view.startMs / step).rounded(.up) * step
        while tick <= view.endMs {
            let x = (tick - view.startMs) / 1000 * view.pointsPerSecond
            context.fill(Path(CGRect(x: x, y: 0, width: 1, height: size.height)), with: .style(.secondary))
            let label =
                step < 1000
                ? RecordingScreenText.preciseTime(milliseconds: Int64(tick))
                : RecordingText.duration(milliseconds: Int64(tick)) ?? ""
            context.draw(
                Text(label).font(.caption2).monospacedDigit().foregroundStyle(.secondary),
                at: CGPoint(x: x + 3, y: 0), anchor: .topLeading)
            tick += step
        }
    }
}

/// A loop handle: a line the height of the waveform with a knob, at the top for the start and at
/// the bottom for the end, so the two read apart where they meet.
private struct HandleMark: View {
    let edge: LoopModel.Edge
    let color: Color

    var body: some View {
        Rectangle()
            .fill(color)
            .frame(width: 2)
            .overlay(alignment: edge == .start ? .top : .bottom) {
                Circle()
                    .fill(color)
                    .frame(width: 12, height: 12)
                    .offset(y: edge == .start ? -6 : 6)
            }
    }
}

extension GraphicsContext {
    /// Draws `peaks` as bars across `rect`, or a plain timeline bar when there are none.
    func fillPeakBars(_ peaks: ShownPeaks?, in rect: CGRect, style: HierarchicalShapeStyle) {
        let barWidth: CGFloat = 2
        let step: CGFloat = 3
        let levels = peaks?.bars(Int(rect.width / step)) ?? []
        var path = Path()
        if levels.isEmpty {
            path.addRoundedRect(
                in: CGRect(x: rect.minX, y: rect.midY - 2, width: rect.width, height: 4),
                cornerSize: CGSize(width: 2, height: 2))
        } else {
            for (index, level) in levels.enumerated() {
                let bar = max(2, level * rect.height)
                path.addRoundedRect(
                    in: CGRect(
                        x: rect.minX + CGFloat(index) * step, y: rect.midY - bar / 2, width: barWidth, height: bar),
                    cornerSize: CGSize(width: 1, height: 1))
            }
        }
        fill(path, with: .style(style))
    }
}
