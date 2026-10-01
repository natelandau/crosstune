import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import Foundation
import Observation
import SwiftUI

/// The writes Practice makes to a recording's loops.
struct LoopWriter {
    var add: @MainActor (_ recordingID: String, _ span: LoopSpan) async throws -> RecordingLoop
    /// Changes a loop's span when `span` is set, and its label as `label` says.
    var update: @MainActor (_ id: String, _ span: LoopSpan?, _ label: Patch<String?>) async throws -> Void
    var remove: @MainActor (_ id: String) async throws -> Void
    var restore: @MainActor (_ id: String) async throws -> Void

    static func commands(_ commands: CrosstuneCommands.Commands) -> LoopWriter {
        LoopWriter(
            add: { try await commands.addLoop(recordingID: $0, startMs: $1.startMs, endMs: $1.endMs) },
            update: { id, span, label in
                try await commands.updateLoop(
                    id, startMs: span.map { .value($0.startMs) } ?? .keep,
                    endMs: span.map { .value($0.endMs) } ?? .keep,
                    label: label)
            },
            remove: { try await commands.removeLoop($0) },
            restore: { try await commands.restoreLoop($0) })
    }
}

/// Practice for the loaded recording: A B, the zoom, drafts of loops being dragged, naming,
/// and undo. The selection and Repeat belong to the player's ``LoopPlayback``, so they outlive
/// this screen; every write here is one per gesture, made when the gesture ends.
@MainActor
@Observable
final class PracticeModel {
    /// A B's mark: a start against the playhead, then the loop being written.
    enum Mark: Equatable {
        case marking(startMs: Int64, at: ContinuousClock.Instant)
        case saving(LoopSpan)
    }

    /// A loop shown ahead of its row. `base` is the row's span when the draft began, nil for a
    /// loop that has no row yet. `sent` holds the spans already written for it, which the row
    /// can pass through on its way to the latest.
    struct Draft: Equatable {
        var span: LoopSpan
        var base: LoopSpan?
        var sent: [LoopSpan] = []
    }

    /// A change Practice made, which undo takes back.
    enum Edit: Sendable {
        case remove(id: String, reselect: Bool)
        case restore(id: String, reselect: Bool)
        case span(id: String, from: LoopSpan, to: LoopSpan)
        case label(id: String, from: String?, to: String?)

        var inverse: Edit {
            switch self {
            case .remove(let id, let reselect): .restore(id: id, reselect: reselect)
            case .restore(let id, let reselect): .remove(id: id, reselect: reselect)
            case .span(let id, let from, let to): .span(id: id, from: to, to: from)
            case .label(let id, let from, let to): .label(id: id, from: to, to: from)
            }
        }
    }

    /// A second A B tap sooner than this after the first is taken for a slip and cancels.
    static let markDoubleTap: Duration = .milliseconds(500)
    /// How far the playhead may stray from where playing would put it before it counts as a seek.
    static let jumpTolerance: TimeInterval = 0.5
    /// How long a loop New loop makes runs, before the trim range cuts it short.
    static let newLoopMs: Int64 = 4000
    static let nudgeMs: Int64 = 100
    static let largeNudgeMs: Int64 = 1000
    static let zoomStep = 2.0
    /// The key a loop still being drawn goes under among the drafts.
    nonisolated static let newDraft = ""

    let player: PlayerModel
    private(set) var recording: Recording
    private(set) var file: RecordingFile?
    /// The recording's tune's part structure, for name suggestions.
    var partStructure: String?
    private(set) var mark: Mark?
    private(set) var drafts: [String: Draft] = [:]
    /// The draft a gesture is still drawing, which waits for the gesture to end.
    var activeKey: String?
    /// The loop whose name field is open.
    private(set) var renaming: String?
    /// The undo offered for the last delete.
    var undoBanner: UndoOffer?
    /// Why the last loop write did not land.
    var failure: String?
    /// Counts snaps, so each one can play a haptic.
    private(set) var snaps = 0

    /// The view's width in points; 0 until measured.
    private(set) var width: Double = 0
    private(set) var zoom: PracticeZoom?
    var laneMetrics = LaneMetrics.standard
    /// Whether a drag snaps its edges; holding Option turns it off.
    var snapsEdges = true
    /// How deep a drag is into either end's auto-pan zone, from -1 at the left edge to 1 at the
    /// right; 0 outside both.
    private(set) var autoPan: Double = 0

    @ObservationIgnored var undoManager: UndoManager?
    @ObservationIgnored let writer: LoopWriter
    @ObservationIgnored private let clock: () -> ContinuousClock.Instant
    @ObservationIgnored private let announce: (String) -> Void
    @ObservationIgnored var gesture: ActiveDrag?
    @ObservationIgnored var pinches = 0
    @ObservationIgnored var pinchBase: PracticeZoom?
    /// Where the pinch under way began, on the trimmed timeline.
    @ObservationIgnored private var pinchAnchorMs: Double?
    /// A name field's text waiting to be written after the field lost focus.
    @ObservationIgnored private var blurred: Task<Void, Never>?
    @ObservationIgnored private var blurredText: String?
    /// How long a name field that lost focus waits before it writes, so a suggestion chip
    /// whose press took the focus away writes its own name instead.
    @ObservationIgnored var blurDelay: Duration = .milliseconds(300)
    @ObservationIgnored private var nudging: (id: String, origin: LoopSpan)?
    @ObservationIgnored private var renameOpened = ""
    @ObservationIgnored private var lastReading: (elapsed: TimeInterval, at: ContinuousClock.Instant)?
    @ObservationIgnored private var writes: [UUID: Task<Void, Never>] = [:]

    init(
        player: PlayerModel, recording: Recording, file: RecordingFile?, writer: LoopWriter,
        clock: @escaping () -> ContinuousClock.Instant = { .now },
        announce: @escaping (String) -> Void = { AccessibilityNotification.Announcement($0).post() }
    ) {
        self.player = player
        self.recording = recording
        self.file = file
        self.writer = writer
        self.clock = clock
        self.announce = announce
    }

    // MARK: The recording

    var trimStartMs: Int64 { recording.trimStartMs }

    var isLoaded: Bool { player.recordingAudio == .loaded && !player.audio.hasFailed }

    /// The trimmed recording's length: the player's once its audio is loaded, else the row's.
    var lengthMs: Int64 {
        if isLoaded, let duration = player.audio.duration { return Int64((duration * 1000).rounded()) }
        guard let end = recording.trimEndMs ?? recording.sourceDurationMs ?? file?.localDurationMs else { return 0 }
        return max(0, end - trimStartMs)
    }

    /// The trim range on the source timeline, which no loop leaves.
    var bounds: LoopSpan { LoopSpan(startMs: trimStartMs, endMs: trimStartMs + lengthMs) }

    /// The playhead on the trimmed timeline.
    var positionMs: Double { isLoaded ? player.audio.elapsed * 1000 : 0 }

    /// The playhead on the source timeline.
    var playheadMs: Int64 { trimStartMs + Int64(positionMs.rounded()) }

    /// Takes the recording's row and file as they now stand.
    func follow(_ recording: Recording, file: RecordingFile?) {
        if recording != self.recording { self.recording = recording }
        if file != self.file { self.file = file }
    }

    // MARK: Loops and selection

    var loops: [RecordingLoop] { player.loops.rows }
    var selectedID: String? { player.loops.selectedID }
    var selected: RecordingLoop? { player.loops.selected }
    var isRepeating: Bool { player.loops.isRepeating }
    /// Repeat needs a loop selected and the audio loaded to repeat it in.
    var canRepeat: Bool { selectedID != nil && isLoaded }

    /// Whether a loop can be made now, and why not when there is a reason to give.
    var create: (allowed: Bool, reason: String?) {
        LoopModel.canCreate(liveCount: loops.count, bounds: bounds)
    }

    /// Whether A B and New loop show at all: only a recording too short to hold a loop has no
    /// reason to give, and then they have no use.
    var showsCreate: Bool { create.allowed || create.reason != nil }

    func name(_ loop: RecordingLoop) -> String {
        LoopModel.name(label: loop.label, startMs: loop.startMs, trimStartMs: trimStartMs)
    }

    func select(_ id: String?) {
        player.loops.select(id)
    }

    /// A tap on a row of the loop list: selects it and frames it, or names it when it is
    /// already selected.
    func choose(_ id: String) {
        guard let row = loops.first(where: { $0.id == id }) else { return }
        if id == selectedID {
            beginRename(id)
            return
        }
        select(id)
        fit(LoopSpan(startMs: row.startMs, endMs: row.endMs))
    }

    func toggleRepeat() {
        player.loops.toggleRepeat()
    }

    /// The span a loop shows: its draft until the row has caught up, else its row.
    func shownSpan(_ id: String) -> LoopSpan? {
        let row = (loops.first { $0.id == id } ?? (selected?.id == id ? selected : nil)).map(Self.span)
        guard let draft = drafts[id] else { return row }
        guard let row else { return draft.span }
        return hasLanded(id, draft) ? row : draft.span
    }

    /// Whether loop `id`'s row has caught up with `draft`: it holds the drafted span, or it has
    /// moved off `base` (a write, this device's or a newer one, has landed) and no gesture is
    /// still drawing it.
    private func hasLanded(_ id: String, _ draft: Draft) -> Bool {
        guard let row = (loops.first { $0.id == id } ?? (selected?.id == id ? selected : nil)).map(Self.span)
        else { return false }
        if row == draft.span { return true }
        return id != activeKey && draft.base != row && !draft.sent.contains(row)
    }

    static func span(_ loop: RecordingLoop) -> LoopSpan {
        LoopSpan(startMs: loop.startMs, endMs: loop.endMs)
    }

    // MARK: A B

    var isMarking: Bool {
        if case .marking = mark { true } else { false }
    }

    /// What the lane draws for A B: start to playhead, then the new loop until it is written.
    var markBand: LoopSpan? {
        switch mark {
        case .marking(let start, _): LoopSpan(startMs: start, endMs: max(start, playheadMs))
        case .saving(let span): span
        case nil: nil
        }
    }

    /// A B: marks the start, or with a start marked, makes the loop.
    func markAB() {
        guard case .marking(let start, let at) = mark else {
            beginMark()
            return
        }
        if clock() - at < Self.markDoubleTap {
            mark = nil
            return
        }
        finishMark(from: start)
    }

    /// `[`: the selected loop's start to the playhead, or with none selected, a new mark.
    func markStart() {
        if !moveEdge(.start) { beginMark() }
    }

    /// `]`: the selected loop's end to the playhead, or with a mark pending, the loop.
    func markEnd() {
        if case .marking(let start, _) = mark {
            finishMark(from: start)
        } else {
            _ = moveEdge(.end)
        }
    }

    /// Drops a pending mark; false when there was none.
    @discardableResult
    func cancelMark() -> Bool {
        guard isMarking else { return false }
        mark = nil
        return true
    }

    /// Takes a reading of the player: a playhead that jumped (a seek, or a wrap) drops a
    /// pending mark, and one that left the view turns the page.
    func observe(elapsed: TimeInterval) {
        ensureZoom()
        let now = clock()
        defer { lastReading = (elapsed, now) }
        guard let last = lastReading else { return }
        let rate = player.audio.isPlaying ? Double(player.speedPercent) / 100 : 0
        let expected = last.elapsed + seconds(now - last.at) * rate
        if isMarking, abs(elapsed - expected) > Self.jumpTolerance { mark = nil }
        guard player.audio.isPlaying, let current = currentZoom else { return }
        let shown = current.visibleSpan(width: width)
        func inside(_ seconds: TimeInterval) -> Bool {
            seconds * 1000 >= shown.startMs && seconds * 1000 <= shown.endMs
        }
        if inside(last.elapsed) && !inside(elapsed) {
            zoom = current.paged(toKeep: elapsed * 1000, width: width).clamped(to: frame)
        }
    }

    private func seconds(_ duration: Duration) -> TimeInterval {
        let parts = duration.components
        return Double(parts.seconds) + Double(parts.attoseconds) / 1e18
    }

    private func beginMark() {
        guard create.allowed, isLoaded else { return }
        mark = .marking(startMs: playheadMs, at: clock())
        lastReading = (player.audio.elapsed, clock())
        announce(PracticeText.loopStartMarked)
    }

    private func finishMark(from start: Int64) {
        let span = LoopModel.fromDrag(
            anchor: start, pointer: max(playheadMs, start + LoopModel.minLoopMs), bounds: bounds)
        mark = .saving(span)
        let recordingID = recording.id
        run { [self] in
            do {
                let row = try await writer.add(recordingID, span)
                if mark == .saving(span) { mark = nil }
                // Let go of any loop repeating now, so Repeat starts on this one rather than
                // jumping into the old one.
                player.loops.select(nil)
                player.loops.select(row)
                player.loops.setRepeat(true)
                record(.restore(id: row.id, reselect: true), name: PracticeText.undoCreate)
                announce(PracticeText.loopCreated)
            } catch {
                if mark == .saving(span) { mark = nil }
                report(error)
            }
        }
    }

    /// Moves the selected loop's `edge` to the playhead; false when no loop is selected.
    private func moveEdge(_ edge: LoopModel.Edge) -> Bool {
        guard let row = selected else { return false }
        let old = Self.span(row)
        let next = LoopModel.resize(old, edge: edge, to: playheadMs, bounds: bounds)
        if next != old { perform(.span(id: row.id, from: old, to: next), name: PracticeText.undoMove) }
        return true
    }

    // MARK: New, rename, delete

    /// Makes a four second loop at the playhead, selects it, and frames it.
    func newLoop() {
        guard create.allowed, isLoaded, lengthMs > 0 else { return }
        let span = LoopModel.fromDrag(anchor: playheadMs, pointer: playheadMs + Self.newLoopMs, bounds: bounds)
        add(span) { [self] _ in fit(span) }
    }

    /// Writes a new loop and selects it.
    func add(_ span: LoopSpan, then: @escaping @MainActor (RecordingLoop) -> Void = { _ in }) {
        let recordingID = recording.id
        run { [self] in
            do {
                let row = try await writer.add(recordingID, span)
                dropDraft(Self.newDraft)
                drafts[row.id] = Draft(span: span, base: nil)
                player.loops.select(row)
                record(.restore(id: row.id, reselect: true), name: PracticeText.undoCreate)
                then(row)
            } catch {
                dropDraft(Self.newDraft)
                report(error)
            }
        }
    }

    func beginRename(_ id: String) {
        guard let row = loops.first(where: { $0.id == id }) else { return }
        // A field that just lost focus writes to its own loop before another field opens.
        flushBlur()
        renameOpened = row.label ?? ""
        renaming = id
    }

    /// Return on the selected loop: opens its name field.
    func renameSelected() -> Bool {
        guard let selectedID, renaming == nil else { return false }
        beginRename(selectedID)
        return true
    }

    /// Closes the name field, writing `text` unless it is the name the field opened with, so a
    /// rename made meanwhile on another device is never written over by a field left untouched.
    /// `expected`, when set, is the loop the text was typed for; a field for any other loop is
    /// left alone.
    func commitRename(_ text: String, for expected: String? = nil) {
        blurred?.cancel()
        blurred = nil
        guard let id = renaming, expected == nil || expected == id else { return }
        renaming = nil
        let opened = renameOpened.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != opened, let row = loops.first(where: { $0.id == id }) else { return }
        perform(.label(id: id, from: row.label, to: trimmed.isEmpty ? nil : trimmed), name: PracticeText.undoRename)
    }

    /// The name field lost focus holding `text`, which is written shortly unless a chip or
    /// Escape closes the field first.
    func renameLostFocus(_ text: String) {
        guard let id = renaming else { return }
        blurred?.cancel()
        blurredText = text
        let delay = blurDelay
        blurred = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.commitRename(text, for: id)
        }
    }

    /// Writes a name waiting after its field lost focus now.
    private func flushBlur() {
        guard blurred != nil, let text = blurredText else { return }
        commitRename(text)
    }

    /// Closes the name field unsaved; false when none was open, or its loop has gone.
    @discardableResult
    func cancelRename() -> Bool {
        blurred?.cancel()
        blurred = nil
        guard let id = renaming else { return false }
        renaming = nil
        return loops.contains { $0.id == id }
    }

    /// Names for loop `id` from the tune's parts, with labels other loops use last.
    func suggestions(for id: String) -> [String] {
        let used = loops.filter { $0.id != id }.compactMap {
            $0.label?.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty }
        return LoopModel.partSuggestions(partStructure: partStructure, used: used)
    }

    func delete(_ id: String) {
        guard loops.contains(where: { $0.id == id }) else { return }
        if renaming == id { renaming = nil }
        let edit = Edit.remove(id: id, reselect: id == selectedID)
        perform(edit, name: PracticeText.undoDelete)
        undoBanner = UndoOffer(message: PracticeText.loopDeleted) { [weak self] in self?.takeBack(edit) }
    }

    /// Delete with a loop selected: removes it.
    func deleteSelected() -> Bool {
        guard let selectedID, renaming == nil else { return false }
        delete(selectedID)
        return true
    }

    /// Takes back the last delete the banner offers, or else the last edit.
    func undo() {
        if let offer = undoBanner {
            undoBanner = nil
            offer.undo()
        } else {
            undoManager?.undo()
        }
    }

    /// The banner's undo: through the undo manager when its top action is a loop delete, which
    /// a newer edit would have replaced along with the banner, so Redo can put it back; directly
    /// otherwise.
    private func takeBack(_ edit: Edit) {
        if let undoManager, undoManager.canUndo, undoManager.undoActionName == PracticeText.undoDelete {
            undoManager.undo()
        } else {
            perform(edit.inverse, name: PracticeText.undoDelete)
        }
    }

    // MARK: Writes and undo

    /// Makes `edit` and registers its inverse with the undo manager.
    func perform(_ edit: Edit, name: String) {
        record(edit, name: name)
        switch edit {
        case .remove(let id, _):
            run { [self] in
                do { try await writer.remove(id) } catch { report(error) }
            }
        case .restore(let id, let reselect):
            run { [self] in
                do {
                    try await writer.restore(id)
                    if reselect { player.loops.select(id) }
                } catch {
                    report(error)
                }
            }
        case .span(let id, _, let span):
            putDraft(id, span)
            drafts[id]?.sent.append(span)
            if id == selectedID { player.loops.hold(id, span) }
            run { [self] in
                do {
                    try await writer.update(id, span, .keep)
                } catch {
                    dropDraft(id)
                    if id == selectedID { player.loops.hold(id, nil) }
                    report(error)
                }
            }
        case .label(let id, _, let label):
            run { [self] in
                do { try await writer.update(id, nil, .value(label)) } catch { report(error) }
            }
        }
    }

    /// Registers the undo of `edit`, just made. A newer edit puts away the delete banner, whose
    /// undo is then no longer the last.
    private func record(_ edit: Edit, name: String) {
        if case .remove = edit {} else { undoBanner = nil }
        guard let undoManager else { return }
        // A manager that does not group by event (as in a test) gets a group per edit.
        let grouped = !undoManager.groupsByEvent && !undoManager.isUndoing && !undoManager.isRedoing
        if grouped { undoManager.beginUndoGrouping() }
        let inverse = edit.inverse
        undoManager.registerUndo(withTarget: self) { model in
            MainActor.assumeIsolated { model.perform(inverse, name: name) }
        }
        undoManager.setActionName(name)
        if grouped { undoManager.endUndoGrouping() }
    }

    func report(_ error: any Error) {
        if case CommandError.recordingNotFound = error { return }
        if case CommandError.loopLimit = error {
            failure = PracticeText.loopLimit
        } else {
            failure = PracticeText.loopNotSaved
        }
    }

    func run(_ work: @escaping @MainActor () async -> Void) {
        failure = nil
        let key = UUID()
        writes[key] = Task { [weak self] in
            await work()
            self?.writes[key] = nil
        }
    }

    /// Returns once every write under way has landed.
    func settle() async {
        while let (key, write) = writes.first {
            await write.value
            writes[key] = nil
        }
    }

    // MARK: Drafts

    /// Shows `span` for `key` ahead of its row. A draft still waiting on its row keeps the base
    /// it began with; one whose row has caught up gives way, so the next edit takes the row as
    /// it now stands for its base.
    func putDraft(_ key: String, _ span: LoopSpan) {
        for (id, draft) in drafts where hasLanded(id, draft) { drafts[id] = nil }
        let base = drafts[key]?.base ?? loops.first { $0.id == key }.map(Self.span)
        drafts[key] = Draft(span: span, base: base, sent: drafts[key]?.sent ?? [])
    }

    func dropDraft(_ key: String) {
        drafts[key] = nil
    }

    // MARK: Keyboard and VoiceOver

    /// Moves the selected loop's `edge` by `deltaMs` ahead of its row; ``commitNudge()`` writes it.
    func nudge(_ edge: LoopModel.Edge, by deltaMs: Int64) {
        guard let row = selected, let current = shownSpan(row.id) else { return }
        if nudging?.id != row.id { nudging = (row.id, Self.span(row)) }
        let at = edge == .start ? current.startMs : current.endMs
        let next = LoopModel.resize(current, edge: edge, to: at + deltaMs, bounds: bounds)
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
        perform(.span(id: nudged.id, from: nudged.origin, to: span), name: PracticeText.undoMove)
    }

    /// What VoiceOver reads for a handle: "B part start, 0:58".
    func handleValue(_ edge: LoopModel.Edge) -> String {
        guard let row = selected, let span = shownSpan(row.id) else { return "" }
        let ms = edge == .start ? span.startMs : span.endMs
        return PracticeText.handle(
            name(row), edge: edge == .start ? "start" : "end",
            time: RecordingScreenText.preciseTime(milliseconds: ms - trimStartMs))
    }

    /// Practice is going: a pending mark, an open name field, and a gesture under way come to
    /// nothing, and a nudge is written.
    func leave() {
        commitNudge()
        // A field that lost focus on the way out still writes what it held.
        flushBlur()
        // The undo stack outlives this screen, whose model it would otherwise reach for.
        undoManager?.removeAllActions(withTarget: self)
        mark = nil
        renaming = nil
        gesture = nil
        activeKey = nil
        autoPan = 0
        dropDraft(Self.newDraft)
    }

    /// Escape: drops a pending mark or closes the name field; false when there was neither,
    /// and Escape then leaves Practice.
    func escape() -> Bool {
        cancelMark() || cancelRename()
    }

    // MARK: Zoom

    var frame: ZoomFrame { ZoomFrame(width: width, lengthMs: Double(lengthMs)) }

    /// The zoom as it stands for the view's width, or nil until both the width and the length
    /// are known.
    var currentZoom: PracticeZoom? {
        guard width > 0, lengthMs > 0, let zoom else { return nil }
        return zoom.clamped(to: frame)
    }

    var laneView: LaneView? {
        guard let current = currentZoom else { return nil }
        return LaneView(
            startMs: current.visibleSpan(width: width).startMs, pointsPerSecond: current.pointsPerSecond, width: width,
            trimStartMs: trimStartMs)
    }

    var canZoomIn: Bool { (currentZoom?.pointsPerSecond ?? .infinity) < PracticeZoom.maxPointsPerSecond }

    var canZoomOut: Bool {
        guard let current = currentZoom else { return false }
        return current.pointsPerSecond > PracticeZoom.minPointsPerSecond(width: width, lengthMs: Double(lengthMs))
    }

    func setWidth(_ width: Double) {
        guard width != self.width else { return }
        self.width = width
        ensureZoom()
    }

    /// Opens on the selected loop, or 30 seconds around the playhead, once the view can be laid out.
    func ensureZoom() {
        guard zoom == nil, width > 0, lengthMs > 0 else { return }
        let loop = selected.map {
            TimeSpan(startMs: Double($0.startMs - trimStartMs), endMs: Double($0.endMs - trimStartMs))
        }
        zoom = PracticeZoom.opening(loop: loop, playheadMs: positionMs, frame: frame)
    }

    /// Zooms by `factor` around `anchorMs` (trimmed timeline), or the playhead while it is in
    /// view, or the view's center.
    func zoom(by factor: Double, around anchorMs: Double? = nil) {
        guard let current = currentZoom else { return }
        let shown = current.visibleSpan(width: width)
        let anchor =
            anchorMs ?? (positionMs >= shown.startMs && positionMs <= shown.endMs ? positionMs : current.centerMs)
        zoom = current.zoomed(by: factor, around: anchor, in: frame)
    }

    func pan(byMs deltaMs: Double) {
        guard let current = currentZoom else { return }
        zoom = current.panned(by: deltaMs, in: frame)
    }

    /// Centers the view on `ms`, on the trimmed timeline.
    func center(onMs ms: Double) {
        guard let current = currentZoom else { return }
        zoom = PracticeZoom(pointsPerSecond: current.pointsPerSecond, centerMs: ms).clamped(to: frame)
    }

    /// Fit: frames the selected loop, or the whole recording when none is selected.
    func fit() {
        if let row = selected {
            fit(Self.span(row))
        } else if width > 0, lengthMs > 0 {
            let length = Double(lengthMs)
            zoom = PracticeZoom(
                pointsPerSecond: PracticeZoom.minPointsPerSecond(width: width, lengthMs: length), centerMs: length / 2
            ).clamped(to: frame)
        }
    }

    /// Frames `span`, on the source timeline.
    func fit(_ span: LoopSpan) {
        guard width > 0, lengthMs > 0 else { return }
        let trimmed = TimeSpan(startMs: Double(span.startMs - trimStartMs), endMs: Double(span.endMs - trimStartMs))
        zoom = PracticeZoom.fit(trimmed, width: width).clamped(to: frame)
    }

    /// Brings `sourceMs` into view when it is outside it.
    func reveal(_ sourceMs: Int64) {
        guard let current = currentZoom else { return }
        let ms = Double(sourceMs - trimStartMs)
        let shown = current.visibleSpan(width: width)
        if ms < shown.startMs || ms > shown.endMs { center(onMs: ms) }
    }

    /// Zooms to `magnification` of the zoom the pinch began at, around the playhead. The finger
    /// that began a pinch may already have dragged a loop, which goes back unwritten.
    /// `anchorX` is where the pinch began, in points from the view's left edge.
    func pinch(_ magnification: Double, anchorX: Double? = nil) {
        if pinchBase == nil {
            pinchBase = currentZoom
            pinchAnchorMs = anchorX.flatMap { x in laneView.map { $0.startMs + x / $0.pointsPerSecond * 1000 } }
            pinches += 1
            if let key = activeKey {
                dropDraft(key)
                activeKey = nil
            }
            autoPan = 0
        }
        guard let base = pinchBase else { return }
        zoom = base.zoomed(by: magnification, around: pinchAnchorMs ?? positionMs, in: frame)
    }

    func endPinch() {
        pinchBase = nil
        pinchAnchorMs = nil
    }

    /// Zooms by `factor` around the point `x` from the view's left edge, as a Control scroll does.
    func zoom(by factor: Double, aroundX x: Double) {
        guard let view = laneView else { return }
        zoom(by: factor, around: view.startMs + x / view.pointsPerSecond * 1000)
    }

    func setAutoPan(_ depth: Double) {
        if depth != autoPan { autoPan = depth }
    }

    func countSnap() {
        snaps += 1
    }
}
