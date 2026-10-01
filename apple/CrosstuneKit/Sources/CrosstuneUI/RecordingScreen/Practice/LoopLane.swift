import CrosstuneStore
import SwiftUI

/// A ruler-like track with each loop as a labeled bar, overlaps stacked into rows; three rows
/// show and the lane scrolls for more. Where the musician draws, moves, resizes, and picks loops
/// by touch or pointer; the loop list is the way in for the keyboard and VoiceOver.
struct LoopLane: View {
    let model: PracticeModel

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.spacing) private var spacing
    /// True once a drag has turned out to run mostly up or down, which scrolls the rows.
    @State private var isScrolling = false
    /// Resets however a drag ends, cancelled included, so it always lets go.
    @GestureState private var isDragging = false

    private var metrics: LaneMetrics {
        LaneMetrics(rowHeight: spacing(22), rowGap: spacing(4), pad: spacing(4))
    }

    var body: some View {
        let metrics = metrics
        let loops = model.laneLoops
        let rows = (loops.map(\.row).max() ?? -1) + 1
        let shownHeight = metrics.height(rows: LaneMetrics.shownRows)
        ScrollView(.vertical) {
            ZStack(alignment: .topLeading) {
                Color.clear
                if loops.isEmpty && model.showsCreate {
                    Text(PracticeText.loopHint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if let view = model.laneView {
                    ForEach(loops) { loop in
                        bar(loop, view: view, metrics: metrics)
                    }
                    let playhead = view.x(ofSourceMs: Double(model.playheadMs))
                    if playhead >= 0 && playhead <= view.width {
                        Rectangle()
                            .fill(.primary)
                            .frame(width: 2)
                            .offset(x: playhead - 1)
                    }
                }
            }
            .frame(height: max(shownHeight, metrics.height(rows: rows)))
            .contentShape(.rect)
            .onTapGesture { location in model.tapLane(at: location) }
            .simultaneousGesture(drag)
        }
        .scrollDisabled(rows <= LaneMetrics.shownRows)
        .frame(height: shownHeight)
        .background(neutralFill(colorScheme), in: .rect(cornerRadius: 8))
        .clipShape(.rect(cornerRadius: 8))
        .onChange(of: metrics, initial: true) { _, metrics in model.laneMetrics = metrics }
        .onChange(of: isDragging) { _, dragging in
            if !dragging { model.cancelDrag() }
        }
        .accessibilityHidden(true)
    }

    /// A drag past the threshold draws, moves, or resizes; one that runs mostly up or down
    /// scrolls the rows instead.
    private var drag: some Gesture {
        DragGesture(minimumDistance: LoopModel.dragThreshold)
            .updating($isDragging) { _, dragging, _ in dragging = true }
            .onChanged { value in
                if model.gesture == nil && !isScrolling {
                    guard abs(value.translation.width) >= abs(value.translation.height) else {
                        isScrolling = true
                        return
                    }
                    model.beginLaneDrag(at: value.startLocation)
                }
                guard !isScrolling else { return }
                model.drag(toX: Double(value.location.x), snapping: PracticeLanes.snaps(model))
            }
            .onEnded { value in
                isScrolling = false
                model.endDrag(atX: Double(value.location.x), snapping: PracticeLanes.snaps(model))
            }
    }

    @ViewBuilder
    private func bar(_ loop: LaneLoop, view: LaneView, metrics: LaneMetrics) -> some View {
        let x0 = view.x(ofSourceMs: Double(loop.span.startMs))
        let x1 = view.x(ofSourceMs: Double(loop.span.endMs))
        if x1 >= 0 && x0 <= view.width {
            let selected = loop.id == model.selectedID
            let color = LoopColor.color(loop.color, scheme: colorScheme)
            let shape = RoundedRectangle(cornerRadius: 5)
            Text(loop.name)
                .font(.caption)
                .lineLimit(1)
                .padding(.horizontal, 4)
                .frame(width: max(2, x1 - x0), height: metrics.rowHeight, alignment: .leading)
                .foregroundStyle(selected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                .background {
                    if loop.isNew {
                        shape.strokeBorder(.secondary, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    } else {
                        shape.fill(selected ? color : LoopColor.tint(loop.color, scheme: colorScheme))
                            .overlay { shape.strokeBorder(color, lineWidth: 1) }
                    }
                }
                .clipShape(shape)
                .offset(x: x0, y: metrics.rowTop(loop.row))
                .allowsHitTesting(false)
        }
    }
}
