import CrosstuneStore
import Foundation

/// The Loops mode's commands, the keys that edit the selected loop, and its handles.
extension PracticeModel {
    /// Half of the 44 points a handle's target spans around a loop's edge.
    static let handleReach: Double = 22
    /// How near either end of the waveform a handle's drag starts scrolling it.
    static let autoPanZone: Double = 24
    /// How far the waveform scrolls each step with the pointer at the very edge.
    static let autoPanMax: Double = 8

    /// Every loop as shown, drafts included, by start.
    var placedLoops: [PlacedLoop] {
        var rows = loops
        if let selected, !rows.contains(where: { $0.id == selected.id }) { rows.append(selected) }
        return rows.map { PlacedLoop(id: $0.id, span: shownSpan($0.id) ?? Self.span($0), color: $0.color) }
            .sorted { $0.span.startMs < $1.span.startMs }
    }

    // MARK: New, delete, previous, next

    /// Where New loop would go now, or why it cannot.
    var newLoopState: LoopModel.NewLoop {
        LoopModel.newLoop(at: playheadMs, in: placedLoops, bounds: bounds)
    }

    /// Why New loop is off, read as its hint and announced when N is refused; nil when it would
    /// make a loop.
    var newLoopReason: String? {
        switch newLoopState {
        case .span: nil
        case .inside(let id): PracticeText.insideLoop(row(id).map(name) ?? "")
        case .noRoom: PracticeText.noRoom
        case .atCap: PracticeText.loopLimit
        }
    }

    /// Makes a loop around the playhead and selects it, or says why it cannot, which the N key
    /// needs since no reason shows on screen. With no audio to play, the player's
    /// own status says why, and nothing is made.
    func newLoop() {
        guard isLoaded else { return }
        settleGlide()
        guard case .span(let span) = newLoopState else {
            if let newLoopReason { announce(newLoopReason) }
            return
        }
        let recordingID = recording.id
        run { [self] in
            do {
                let row = try await writer.add(recordingID, span)
                player.loops.select(row)
                announce(PracticeText.loopCreated)
            } catch {
                report(error)
            }
        }
    }

    /// Delete: removes the selected loop at once, which plays on straight through; false with
    /// none selected.
    @discardableResult
    func deleteSelected() -> Bool {
        guard isLoaded, let id = selectedID else { return false }
        if renaming == id { cancelRename() }
        select(nil)
        run { [self] in
            do { try await writer.remove(id) } catch { report(error) }
        }
        return true
    }

    /// Delete loop is on with a loop selected and audio to play.
    var canDeleteSelected: Bool { isLoaded && selectedID != nil }

    /// The loop switcher's middle: the selected loop's name, or No loop with none; nil with no
    /// loops at all, when the switcher is gone.
    var switcherLabel: String? {
        if let selected { return name(selected) }
        return placedLoops.isEmpty ? nil : PracticeText.noLoop
    }

    /// Whether Previous or Next has a loop to go to now.
    func canStep(_ direction: LoopModel.Direction) -> Bool {
        isLoaded && adjacent(direction) != nil
    }

    /// The nearest loop starting before or after the playhead, never the selected one.
    func adjacent(_ direction: LoopModel.Direction) -> PlacedLoop? {
        LoopModel.adjacent(direction, from: playheadMs, in: placedLoops, selectedID: selectedID)
    }

    /// Previous or Next: selects the loop that way and brings its start under the playhead.
    func step(_ direction: LoopModel.Direction) {
        guard isLoaded else { return }
        settleGlide()
        guard let target = adjacent(direction) else { return }
        select(target.id)
        seek(toMs: target.span.startMs - trimStartMs)
        if let row = row(target.id) { announce(PracticeText.loopSelected(name(row))) }
    }

    // MARK: Keys

    /// `[` or `]`: the selected loop's `edge` to the playhead, held to the room around it.
    func setEdge(_ edge: LoopModel.Edge) {
        guard isLoaded, let row = selected else { return }
        settleGlide()
        let span = Self.span(row)
        let next = LoopModel.resize(span, edge: edge, to: playheadMs, bounds: room(around: span, of: row.id))
        if next != span { write(row.id, next) }
    }

    /// Moves the selected loop's `edge` by `deltaMs` ahead of its row; ``commitNudge()`` writes it.
    func nudge(_ edge: LoopModel.Edge, by deltaMs: Int64) {
        guard let row = selected, let current = shownSpan(row.id) else { return }
        if nudging?.id != row.id { nudging = (row.id, Self.span(row)) }
        let at = edge == .start ? current.startMs : current.endMs
        let next = LoopModel.resize(current, edge: edge, to: at + deltaMs, bounds: room(around: current, of: row.id))
        activeKey = row.id
        putDraft(row.id, next)
        reveal(edge == .start ? next.startMs : next.endMs)
    }

    /// Writes the nudged loop once, as the key that moved it is let go.
    func commitNudge() {
        guard let nudged = nudging else { return }
        nudging = nil
        if activeKey == nudged.id { activeKey = nil }
        guard let span = drafts[nudged.id]?.span, span != nudged.origin else {
            dropDraft(nudged.id)
            return
        }
        write(nudged.id, span)
    }

    /// What VoiceOver reads for a handle: "B part start, 0:58.3".
    func handleValue(_ edge: LoopModel.Edge) -> String {
        guard let row = selected, let span = shownSpan(row.id) else { return "" }
        let ms = edge == .start ? span.startMs : span.endMs
        return PracticeText.handle(
            name(row), edge: edge == .start ? "start" : "end",
            time: RecordingScreenText.preciseTime(milliseconds: ms - trimStartMs))
    }

    /// The free span around loop `id` at `span`, up to its neighbors or the trim.
    private func room(around span: LoopSpan, of id: String) -> LoopSpan {
        LoopModel.room(around: span, in: placedLoops.filter { $0.id != id }, bounds: bounds)
    }

    // MARK: Handles

    /// A drag on one of the selected loop's handles has passed the threshold.
    func beginHandleDrag(_ edge: LoopModel.Edge) {
        saveOpenRename()
        guard let row = selected, let span = shownSpan(row.id) else { return }
        handleDrag = HandleDrag(
            id: row.id, edge: edge, origin: span, room: room(around: span, of: row.id), pinch: pinches)
    }

    /// The handle's drag is now at `x` points from the waveform's left edge. Shown as a draft,
    /// and played while the playhead stays inside the loop; nothing is written until it ends.
    func dragHandle(toX x: Double, snapping: Bool) {
        guard var drag = handleDrag, drag.pinch == pinches, let view = laneView else { return }
        drag.lastX = x
        drag.snapping = snapping
        drag.moved = true
        let (span, snapped) = resized(drag, atX: x, in: view)
        if let snapped, snapped != drag.snappedTo { snaps += 1 }
        drag.snappedTo = snapped
        handleDrag = drag
        activeKey = drag.id
        putDraft(drag.id, span)
        // A loop dragged off the playhead takes it along on release instead.
        if drag.id == selectedID, playheadMs >= span.startMs, playheadMs < span.endMs {
            player.loops.hold(drag.id, span)
        }
        setAutoPan(autoPanDepth(atX: x))
    }

    /// The handle's drag ends at `x`: a drag that moved writes its loop once; one a pinch took
    /// over, or one that never moved, writes nothing.
    func endHandleDrag(atX x: Double, snapping: Bool) {
        guard var drag = handleDrag else { return }
        guard drag.moved, drag.pinch == pinches, let view = laneView else {
            cancelHandleDrag()
            return
        }
        handleDrag = nil
        activeKey = nil
        setAutoPan(0)
        drag.snapping = snapping
        let (span, _) = resized(drag, atX: x, in: view)
        guard let row = row(drag.id), Self.span(row) != span else {
            letGo(drag.id)
            return
        }
        write(drag.id, span)
    }

    /// A handle's drag the system took away, or a pinch replaced: its loop goes back unwritten.
    func cancelHandleDrag() {
        guard let drag = handleDrag else { return }
        handleDrag = nil
        activeKey = nil
        setAutoPan(0)
        letGo(drag.id)
    }

    /// One step of auto-pan, faster deeper into the zone, then the drag again against the
    /// view that moved under it.
    func autoPanStep() {
        guard autoPan != 0, let drag = handleDrag, let scale else { return }
        seek(byMs: Int64((autoPan * Self.autoPanMax * 1000 / scale).rounded()))
        dragHandle(toX: drag.lastX, snapping: drag.snapping)
    }

    func setAutoPan(_ depth: Double) {
        if depth != autoPan { autoPan = depth }
    }

    private func letGo(_ id: String) {
        dropDraft(id)
        if id == selectedID { player.loops.hold(id, nil) }
    }

    private func autoPanDepth(atX x: Double) -> Double {
        guard width > 0 else { return 0 }
        if x < Self.autoPanZone { return -(Self.autoPanZone - max(0, x)) / Self.autoPanZone }
        if x > width - Self.autoPanZone { return (Self.autoPanZone - max(0, width - x)) / Self.autoPanZone }
        return 0
    }

    /// The span `drag` makes with the pointer at `x`, and the time it snapped to, if any. The
    /// edge stops at the room's ends and snaps to them and, unless `snapping` is off, to the
    /// playhead.
    private func resized(_ drag: HandleDrag, atX x: Double, in view: LaneView) -> (LoopSpan, Int64?) {
        let pointer = Int64(view.sourceMs(atX: x).rounded())
        let targets = (drag.snapping ? [playheadMs] : []) + [drag.room.startMs, drag.room.endMs]
        let snapped = LoopModel.snap(pointer, to: targets, msPerPoint: 1000 / view.pointsPerSecond)
        let span = LoopModel.resize(drag.origin, edge: drag.edge, to: snapped, bounds: drag.room)
        let landed = snapped != pointer || targets.contains(pointer)
        return (span, drag.snapping && landed ? snapped : nil)
    }
}
