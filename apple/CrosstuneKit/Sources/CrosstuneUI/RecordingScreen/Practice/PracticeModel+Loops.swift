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

    /// How far a held handle scrolls the waveform each step at `depth` from -1 to 1 into a
    /// side's zone.
    static func autoPanMs(depth: Double, pointsPerSecond: Double) -> Int64 {
        Int64((depth * autoPanMax * 1000 / pointsPerSecond).rounded())
    }

    /// How far from the center, in ms, a time stays in view before a reveal moves to it.
    static func revealReachMs(width: Double, pointsPerSecond: Double) -> Double {
        max(0, width / 2 - autoPanZone) / pointsPerSecond * 1000
    }

    /// Every loop as shown, drafts included, by start.
    var placedLoops: [PlacedLoop] {
        var rows = loops
        if let selected, !rows.contains(where: { $0.id == selected.id }) { rows.append(selected) }
        return rows.map { PlacedLoop(id: $0.id, span: shownSpan(of: $0), color: $0.color) }
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
        settleMomentumScroll()
        guard case .span(let span) = newLoopState else {
            if let newLoopReason { announce(newLoopReason) }
            return
        }
        let recordingID = recording.id
        run { [self] in
            do {
                let row = try await writer.add(recordingID, span)
                insertedID = row.id
                select(row)
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
        settleMomentumScroll()
        guard let target = adjacent(direction) else { return }
        select(target.id)
        seek(toMs: target.span.startMs - trimStartMs)
        if let row = row(target.id) { announce(PracticeText.loopSelected(name(row))) }
    }

    // MARK: Keys

    /// `[` or `]`: the selected loop's `edge` to the playhead, held to the room around it.
    func setEdge(_ edge: LoopModel.Edge) {
        guard isLoaded, let row = selected else { return }
        settleMomentumScroll()
        let span = Self.span(row)
        let next = LoopModel.resize(span, edge: edge, to: playheadMs, bounds: room(around: span, of: row.id))
        if next != span { write(row.id, next) }
    }

    /// What VoiceOver reads for a handle: "B part start, 0:58.3".
    func handleValue(_ edge: LoopModel.Edge) -> String {
        guard let row = selected, let span = shownSpan(row.id) else { return "" }
        return Self.handleValue(
            edge, of: name(row), atMs: edge == .start ? span.startMs : span.endMs, from: trimStartMs)
    }

    /// The value of loop `name`'s `edge` at `ms` in the source, timed from `trimStartMs`.
    static func handleValue(_ edge: LoopModel.Edge, of name: String, atMs ms: Int64, from trimStartMs: Int64) -> String
    {
        PracticeText.handle(
            name, edge: edge == .start ? "start" : "end",
            time: RecordingScreenText.preciseTime(milliseconds: ms - trimStartMs))
    }

    /// The free span around loop `id` at `span`, up to its neighbors or the trim.
    private func room(around span: LoopSpan, of id: String) -> LoopSpan {
        LoopModel.room(around: span, in: placedLoops.filter { $0.id != id }, bounds: bounds)
    }

    // MARK: Handles

    /// `sourceMs` as the handles place it: seconds on the trimmed timeline.
    func handleSeconds(_ sourceMs: Int64) -> Double {
        HandleTime.seconds(sourceMs, from: trimStartMs)
    }

    /// A handle's place, in seconds on the trimmed timeline, as a time in the source.
    func sourceMs(handleSeconds seconds: Double) -> Int64 {
        HandleTime.sourceMs(seconds, from: trimStartMs)
    }

    /// Where the selected loop's handles snap besides the playhead: the ends of the room around
    /// it, its neighbors or the trim.
    var handleSnapPointsMs: [Int64] {
        guard let row = selected, let span = shownSpan(row.id) else { return [] }
        let room = room(around: span, of: row.id)
        return [room.startMs, room.endMs]
    }

    /// The handles have the selected loop at `proposed`, one edge moved by a drag or, with
    /// `byKeyStep`, by an arrow-key step. Shown as a draft held to the room around it, and played
    /// while the playhead stays inside; nothing is written until ``commitHandles(_:)``.
    func moveHandles(to proposed: LoopSpan, byKeyStep: Bool = false) {
        guard let row = selected, let shown = shownSpan(row.id) else { return }
        if handleDrag == nil {
            guard let part = HandleDrag.Part(from: shown, to: proposed) else { return }
            saveOpenRename()
            handleDrag = HandleDrag(
                id: row.id, part: part, isKeySteps: byKeyStep, origin: shown, room: room(around: shown, of: row.id))
        }
        guard let drag = handleDrag, drag.id == row.id, !drag.isCancelled else { return }
        let span = drag.placed(proposed)
        activeKey = drag.id
        putDraft(drag.id, span)
        // A loop dragged off the playhead takes it along on release instead.
        if playheadMs >= span.startMs, playheadMs < span.endMs {
            hold(drag.id, span)
        }
    }

    /// The handles let go with the loop at `proposed`: a move that changed it writes it once;
    /// one a pinch took over, or one back where it began, writes nothing.
    func commitHandles(_ proposed: LoopSpan) {
        guard let drag = handleDrag else { return }
        handleDrag = nil
        activeKey = nil
        guard !drag.isCancelled else { return }
        let span = drag.placed(proposed)
        guard let row = row(drag.id), Self.span(row) != span else {
            letGo(drag.id)
            return
        }
        write(drag.id, span)
    }

    /// Writes a run of arrow-key steps where it has left the loop, as if the key were let go.
    /// A drag is left alone.
    func commitHandleKeySteps() {
        guard let drag = handleDrag, drag.isKeySteps, !drag.isCancelled, let shown = shownSpan(drag.id) else {
            return
        }
        commitHandles(shown)
    }

    /// A pinch took over the handles' move: the loop goes back unwritten, and the move takes no
    /// more steps until the handles let go.
    func cancelHandleDrag() {
        guard let drag = handleDrag, !drag.isCancelled else { return }
        handleDrag?.isCancelled = true
        activeKey = nil
        letGo(drag.id)
    }

    /// Scrolls the waveform under a held handle, `depth` from -1 to 1 into a side's zone, faster
    /// deeper in.
    func scrollUnderHandle(depth: Double) {
        guard let scale else { return }
        seek(byMs: Self.autoPanMs(depth: depth, pointsPerSecond: scale))
    }

    private func letGo(_ id: String) {
        dropDraft(id)
        if id == selectedID { hold(id, nil) }
    }
}
