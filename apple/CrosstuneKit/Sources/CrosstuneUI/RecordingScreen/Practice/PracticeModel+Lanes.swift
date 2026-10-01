import CoreGraphics
import CrosstuneStore
import Foundation

/// The loop lane's rows, in points, scaled with the text size by the view.
struct LaneMetrics: Equatable {
    var rowHeight: Double
    var rowGap: Double
    var pad: Double

    static let standard = LaneMetrics(rowHeight: 22, rowGap: 4, pad: 4)
    /// Rows the lane shows before it scrolls.
    static let shownRows = 3

    func rowTop(_ row: Int) -> Double {
        pad + Double(row) * (rowHeight + rowGap)
    }

    func row(atY y: Double) -> Int {
        Int(((y - pad) / (rowHeight + rowGap)).rounded(.down))
    }

    /// The lane's height for `rows` rows.
    func height(rows: Int) -> Double {
        rowTop(rows) - rowGap + pad
    }
}

/// A loop as the lane draws it.
struct LaneLoop: Identifiable, Equatable {
    let id: String
    let span: LoopSpan
    let color: Int
    let name: String
    let row: Int
    /// The loop being drawn, by a drag or by A B, which has no row yet.
    var isNew: Bool { id == PracticeModel.newDraft }
}

/// What a drag on the lane or a handle does.
enum LaneGesture: Equatable {
    case create(anchorMs: Double)
    case move(id: String, span: LoopSpan, anchorMs: Double)
    case resize(id: String, span: LoopSpan, edge: LoopModel.Edge)

    var loopID: String? {
        switch self {
        case .create: nil
        case .move(let id, _, _), .resize(let id, _, _): id
        }
    }

    var draftKey: String { loopID ?? PracticeModel.newDraft }
}

/// A drag under way.
struct ActiveDrag {
    let gesture: LaneGesture
    /// The pinch count when it began; a pinch since puts it back unwritten.
    let pinch: Int
    var lastX: Double
    var snapping: Bool
    var moved = false
    /// The time the last snap landed on, so each new snap plays one haptic.
    var snappedTo: Int64?
}

extension PracticeModel {
    /// Half of the 44 points a handle's target spans around a loop's edge.
    static let handleReach: Double = 22
    /// How near either end of the zoomed view a drag starts panning it.
    static let autoPanZone: Double = 24
    /// How far the view pans each step with the pointer at the very edge.
    static let autoPanMax: Double = 8

    /// Every loop as the lane draws it, drafts included, stacked into rows.
    var laneLoops: [LaneLoop] {
        var placed: [(id: String, span: LoopSpan, color: Int, name: String)] = []
        var rows = loops
        if let selected, !rows.contains(where: { $0.id == selected.id }) { rows.append(selected) }
        for row in rows {
            placed.append((row.id, shownSpan(row.id) ?? Self.span(row), row.color, name(row)))
        }
        if let drawing = drafts[Self.newDraft]?.span ?? markBand {
            placed.append((Self.newDraft, drawing, 0, ""))
        }
        let stacked = LoopModel.stackRows(placed.map { PlacedLoop(id: $0.id, span: $0.span, color: $0.color) })
        return placed.map {
            LaneLoop(id: $0.id, span: $0.span, color: $0.color, name: $0.name, row: stacked[$0.id] ?? 0)
        }
    }

    /// What a press at `point` on the lane would do: resize an end within reach, move a body,
    /// or draw a new loop on empty lane. Inside a loop the reach of an end shrinks with the
    /// loop, so a short one keeps a body.
    func laneGesture(at point: CGPoint) -> LaneGesture? {
        guard let view = laneView else { return nil }
        let x = Double(point.x)
        let row = laneMetrics.row(atY: Double(point.y))
        let placed = laneLoops.filter { !$0.isNew && $0.row == row }.map {
            (loop: $0, x0: view.x(ofSourceMs: Double($0.span.startMs)), x1: view.x(ofSourceMs: Double($0.span.endMs)))
        }
        for (loop, x0, x1) in placed {
            let inner = min(Self.handleReach, (x1 - x0) / 4)
            if x >= x0 && x <= x0 + inner { return .resize(id: loop.id, span: loop.span, edge: .start) }
            if x <= x1 && x >= x1 - inner { return .resize(id: loop.id, span: loop.span, edge: .end) }
        }
        for (loop, x0, x1) in placed where x > x0 && x < x1 {
            return .move(id: loop.id, span: loop.span, anchorMs: view.sourceMs(atX: x))
        }
        for (loop, x0, x1) in placed {
            if x < x0 && x0 - x <= Self.handleReach { return .resize(id: loop.id, span: loop.span, edge: .start) }
            if x > x1 && x - x1 <= Self.handleReach { return .resize(id: loop.id, span: loop.span, edge: .end) }
        }
        return .create(anchorMs: view.sourceMs(atX: x))
    }

    /// A tap on the lane selects the loop under it.
    func tapLane(at point: CGPoint) {
        guard let id = laneGesture(at: point)?.loopID else { return }
        select(id)
    }

    /// A drag on the lane, past the threshold, starting at `point`.
    func beginLaneDrag(at point: CGPoint) {
        guard let gesture = laneGesture(at: point) else { return }
        if case .create = gesture, !create.allowed { return }
        self.gesture = ActiveDrag(gesture: gesture, pinch: pinches, lastX: Double(point.x), snapping: true)
    }

    /// A drag on one of the selected loop's handles on the zoomed waveform.
    func beginHandleDrag(_ edge: LoopModel.Edge) {
        guard let row = selected, let span = shownSpan(row.id) else { return }
        gesture = ActiveDrag(
            gesture: .resize(id: row.id, span: span, edge: edge), pinch: pinches, lastX: 0, snapping: true)
    }

    /// The drag under way is now at `x` points from the view's left edge. Shown as a draft;
    /// nothing is written until it ends.
    func drag(toX x: Double, snapping: Bool) {
        guard var drag = gesture, drag.pinch == pinches else { return }
        drag.lastX = x
        drag.moved = true
        drag.snapping = snapping
        let (span, snapped) = draft(drag.gesture, atX: x, snapping: snapping)
        if let snapped, snapped != drag.snappedTo { countSnap() }
        drag.snappedTo = snapped
        gesture = drag
        activeKey = drag.gesture.draftKey
        putDraft(drag.gesture.draftKey, span)
        setAutoPan(autoPanDepth(atX: x))
    }

    /// The drag ends at `x`: a drag that moved writes its loop once; one a pinch took over, or
    /// one that never moved, writes nothing.
    func endDrag(atX x: Double, snapping: Bool) {
        guard let drag = gesture else { return }
        gesture = nil
        activeKey = nil
        setAutoPan(0)
        let key = drag.gesture.draftKey
        guard drag.moved, drag.pinch == pinches else {
            dropDraft(key)
            return
        }
        let (span, _) = draft(drag.gesture, atX: x, snapping: snapping)
        commit(drag.gesture, span)
    }

    /// A drag the system took away: its loop goes back unwritten.
    func cancelDrag() {
        guard let drag = gesture else { return }
        gesture = nil
        activeKey = nil
        setAutoPan(0)
        dropDraft(drag.gesture.draftKey)
    }

    /// One step of auto-pan, deeper into the zone faster, then the drag again against the
    /// view that moved under it.
    func autoPanStep() {
        guard autoPan != 0, let drag = gesture, let view = laneView else { return }
        pan(byMs: autoPan * Self.autoPanMax * 1000 / view.pointsPerSecond)
        self.drag(toX: drag.lastX, snapping: drag.snapping)
    }

    private func autoPanDepth(atX x: Double) -> Double {
        guard width > 0 else { return 0 }
        if x < Self.autoPanZone { return -(Self.autoPanZone - max(0, x)) / Self.autoPanZone }
        if x > width - Self.autoPanZone { return (Self.autoPanZone - max(0, width - x)) / Self.autoPanZone }
        return 0
    }

    private func commit(_ gesture: LaneGesture, _ span: LoopSpan) {
        guard let id = gesture.loopID else {
            guard create.allowed else {
                dropDraft(Self.newDraft)
                return
            }
            putDraft(Self.newDraft, span)
            add(span)
            return
        }
        guard let row = loops.first(where: { $0.id == id }), Self.span(row) != span else {
            dropDraft(id)
            return
        }
        perform(.span(id: id, from: Self.span(row), to: span), name: PracticeText.undoMove)
    }

    /// The span `gesture` makes with the pointer at `x`, and the time it snapped to, if any.
    /// Edges snap to the playhead and the other loops' edges unless `snapping` is off.
    private func draft(_ gesture: LaneGesture, atX x: Double, snapping: Bool) -> (LoopSpan, Int64?) {
        guard let view = laneView else {
            switch gesture {
            case .create(let anchor): return (LoopSpan(startMs: Int64(anchor), endMs: Int64(anchor)), nil)
            case .move(_, let span, _), .resize(_, let span, _): return (span, nil)
            }
        }
        let msPerPoint = 1000 / view.pointsPerSecond
        var targets = [playheadMs]
        for loop in laneLoops where !loop.isNew && loop.id != gesture.loopID {
            targets += [loop.span.startMs, loop.span.endMs]
        }
        var snappedTo: Int64?
        func snap(_ ms: Double) -> Int64 {
            let rounded = Int64(ms.rounded())
            guard snapping else { return rounded }
            let snapped = LoopModel.snap(rounded, to: targets, msPerPoint: msPerPoint)
            if snapped != rounded || targets.contains(rounded) { snappedTo = snapped }
            return snapped
        }
        let pointer = view.sourceMs(atX: x)
        switch gesture {
        case .create(let anchor):
            return (LoopModel.fromDrag(anchor: snap(anchor), pointer: snap(pointer), bounds: bounds), snappedTo)
        case .resize(_, let span, let edge):
            return (LoopModel.resize(span, edge: edge, to: snap(pointer), bounds: bounds), snappedTo)
        case .move(_, let span, let anchor):
            let moved = LoopModel.move(span, by: Int64((pointer - anchor).rounded()), bounds: bounds)
            let start = snap(Double(moved.startMs))
            let shift = start != moved.startMs ? start - moved.startMs : snap(Double(moved.endMs)) - moved.endMs
            return (LoopModel.move(moved, by: shift, bounds: bounds), snappedTo)
        }
    }
}
