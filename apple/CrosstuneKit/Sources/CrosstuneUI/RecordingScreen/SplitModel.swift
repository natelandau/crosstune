import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import Foundation
import Observation

/// The Split screen's cuts, the line they are placed at, its transport, and the one write it
/// makes. Every value in ms is on the source timeline; the audio player counts seconds from
/// `bounds.lowerBound`. Mirrors the web's `useSplitEditor.ts`; its rules are ``State``.
///
/// The line is where a new cut lands: the play position while playing, else where it was left.
/// A selected cut moves with the line. A new cut starts selected, so Remove cut undoes it at
/// once. Each cut also has a handle on the zoomed strip that moves that cut alone. Play stops at
/// the first cut after where it starts, with the line on it, so each Play hears one piece.
@MainActor
@Observable
final class SplitModel {
    /// Writes a split of recording `recordingID` at `cutsMs`.
    typealias Write = @MainActor (_ recordingID: String, _ cutsMs: [Int64]) async throws -> Void
    typealias Hold = TrimModel.Hold
    /// Ends the player's playback exactly at a time on the source timeline, or at the trim end
    /// when nil.
    typealias EndPlayback = @MainActor (_ sourceMs: Int64?) -> Void

    let recordingID: String
    /// The cuts, the line, and their rules.
    private(set) var state: State
    /// Whether the Save question is up.
    var isConfirming = false
    private(set) var isSaving = false
    /// Set once the screen has given way, after which it writes and holds nothing.
    private(set) var hasLeft = false
    /// Set once the row's trim has changed from elsewhere. Every cut counts from the trim the
    /// screen opened on, so it writes nothing after, lest it cut somewhere not chosen.
    private(set) var isStale = false
    /// The zoomed strip's width in points, which sets its scale.
    var width: Double = 0
    /// The piece Play plays alone, from its start to its end.
    private(set) var selectedPiece: Int?
    /// How deep into either end of the strip a cut's drag is, -1 to 1, which scrolls it.
    private(set) var autoPan: Double = 0
    /// Counts each snap a cut's drag lands on, for one haptic each.
    private(set) var cutSnaps = 0
    /// The cut handle drag under way.
    @ObservationIgnored private(set) var cutDrag: CutDrag?
    /// Where the playback under way stops, on the source timeline: the end of its piece.
    @ObservationIgnored private var stopAtMs: Int64?
    @ObservationIgnored private var endPlayback: EndPlayback = { _ in }
    /// The scale chosen by a zoom, or nil for the opening one.
    private var chosenPointsPerSecond: Double?

    @ObservationIgnored private let write: Write
    @ObservationIgnored private let hold: Hold
    @ObservationIgnored private let analytics: AnalyticsClient
    @ObservationIgnored private var isHolding = false
    @ObservationIgnored private let opened: TrimModel.Patch
    @ObservationIgnored private var writing: TrimModel.Patch?
    @ObservationIgnored private weak var transport: (any PlaybackTransport)?
    /// Whether playback is under way as far as this model knows. Its own pause clears this
    /// before the player reports the pause, so that report never moves a line edited since.
    @ObservationIgnored private var believesPlaying = false
    /// The last position seen while playing, which tells running off the end from a pause.
    @ObservationIgnored private var lastPlayingElapsed: TimeInterval?
    /// Where the line was as the drag under way began, and the whole state, for a pinch that
    /// replaces the drag to put back.
    @ObservationIgnored private var scrubOrigin: (lineMs: Int64, state: State)?
    @ObservationIgnored private(set) var scrubCancelled = false
    @ObservationIgnored private var pinchBase: Double?

    /// A drag on cut `index`'s handle.
    struct CutDrag {
        let index: Int
        /// The cut when the drag began, which a pinch that takes over puts back.
        let originMs: Int64
        var lastX: Double = 0
        var snapping = true
        var moved = false
        /// Set once a pinch has taken over, after which the drag moves nothing.
        var cancelled = false
        /// The time the last snap landed on, so each new snap plays one haptic.
        var snappedTo: Int64?
    }

    init(
        recording: Recording, file: RecordingFile?, write: @escaping Write, hold: @escaping Hold,
        analytics: AnalyticsClient = .noop
    ) {
        recordingID = recording.id
        let low = recording.trimStartMs
        let high = max(low, RecordingLimits.splitRangeEnd(recording, file: file) ?? low)
        state = State(
            lowMs: low, highMs: high, lineMs: low, overLimit: high - low > RecordingLimits.maxRecordingMs)
        opened = TrimModel.Patch(trimStartMs: recording.trimStartMs, trimEndMs: recording.trimEndMs)
        self.write = write
        self.hold = hold
        self.analytics = analytics
    }

    /// The row's trim when the screen opened, which the cuts cannot leave.
    var bounds: ClosedRange<Int64> { state.lowMs...state.highMs }
    var canStepPrevious: Bool { state.applying(.previous) != state }
    var canStepNext: Bool { state.applying(.next) != state }

    // MARK: Playback

    var isPlaying: Bool { transport?.isPlaying == true }

    /// The play position on the source timeline.
    var playheadMs: Int64 {
        let elapsed = Int64(((transport?.elapsed ?? 0) * 1000).rounded())
        return bounds.lowerBound + min(max(elapsed, 0), bounds.upperBound - bounds.lowerBound)
    }

    /// The line as shown: the play position while playing.
    var shownLineMs: Int64 { isPlaying ? playheadMs : state.lineMs }

    /// True when the main button would add a cut at the line now.
    var canAddCut: Bool {
        var shown = state
        shown.lineMs = shownLineMs
        return shown.canAddCut
    }

    /// Attaches the player once its audio has loaded. The line opens where practice left it.
    /// `endPlayback` ends the player's playback at a stop, so it ends exactly on a cut.
    func attach(_ transport: any PlaybackTransport, endPlayback: @escaping EndPlayback = { _ in }) {
        self.transport = transport
        self.endPlayback = endPlayback
        believesPlaying = transport.isPlaying
        if !transport.isPlaying { apply(.seek(playheadMs)) }
    }

    /// Follows a reading of the player. A stop this model did not ask for leaves the line where
    /// playback got to, or at the end for playback that ran off it.
    func follow(playing: Bool, elapsed: TimeInterval) {
        if playing {
            believesPlaying = true
            lastPlayingElapsed = elapsed
            return
        }
        guard believesPlaying else { return }
        believesPlaying = false
        let end = stopAtMs ?? bounds.upperBound
        setStop(nil)
        // The player returns to the start on reaching the end of what it plays, and only there.
        let ranOff = elapsed == 0 && (lastPlayingElapsed ?? 0) > 0
        lastPlayingElapsed = nil
        apply(.seek(ranOff ? end : bounds.lowerBound + Int64((elapsed * 1000).rounded())))
        // Even with the line already there, the player went back to the start.
        if ranOff { transport?.seek(to: seconds(end)) }
        apply(.rest)
    }

    func togglePlay() {
        guard let transport else { return }
        if transport.isPlaying {
            let at = playheadMs
            pause()
            apply(.seek(at))
            apply(.rest)
            return
        }
        let piece = selectedPiece.flatMap { state.pieces.indices.contains($0) ? state.pieces[$0] : nil }
        let startMs = piece?.startMs ?? state.lineMs
        apply(.seek(startMs))
        setStop(stopMs(after: startMs))
        believesPlaying = true
        lastPlayingElapsed = nil
        transport.seek(to: seconds(startMs))
        transport.play()
    }

    /// Moves the line to `ms`, letting go of a selected cut and piece, as a tap on the whole
    /// recording does. While playing, only the play position moves.
    func seek(to ms: Int64) {
        selectedPiece = nil
        seekLine(to: ms)
    }

    /// Skips the line, keeping a selected piece.
    func skip(by deltaMs: Int64) {
        seekLine(to: shownLineMs + deltaMs)
    }

    /// The cut that ends the piece holding `ms`, or the range end.
    private func stopMs(after ms: Int64) -> Int64 {
        state.cuts.first { $0 > ms } ?? state.highMs
    }

    private func seekLine(to ms: Int64) {
        if let transport, transport.isPlaying {
            let clamped = min(max(ms, bounds.lowerBound), bounds.upperBound)
            let to = seconds(clamped)
            // Playback from here stops at the end of the piece it lands in. The player's end
            // must always lie past its position, or it would end at once.
            let stop = stopMs(after: clamped)
            if to > transport.elapsed {
                setStop(stop)
                transport.seek(to: to)
            } else {
                transport.seek(to: to)
                setStop(stop)
            }
            // A seek to the start is not playback running off the end.
            lastPlayingElapsed = to
            return
        }
        apply(.seek(ms))
        apply(.rest)
    }

    /// Sets where playback stops, and ends the player's playback there; the range end needs no
    /// early end.
    private func setStop(_ ms: Int64?) {
        stopAtMs = ms
        endPlayback(ms == state.highMs ? nil : ms)
    }

    // MARK: Editing

    /// Adds a cut at the line, or removes the selected one.
    func pressMain() {
        guard state.selected != nil else {
            addCut()
            return
        }
        selectedPiece = nil
        apply(.removeCut)
    }

    /// A cut made while playing lands at the play position, and playback carries on.
    func addCut() {
        selectedPiece = nil
        if isPlaying { apply(.seek(playheadMs)) }
        apply(.addCut)
    }

    func nudge(by deltaMs: Int64) {
        holdForEdit()
        apply(.nudge(deltaMs))
        apply(.rest)
    }

    /// Selects cut `index`, or lets it go when it is already selected.
    func select(_ index: Int) {
        holdForEdit()
        if state.selected == index { apply(.seek(state.lineMs)) } else { apply(.select(index)) }
    }

    /// Whether cut `index` is selected, for a toggle bound to it.
    subscript(cutSelected index: Int) -> Bool {
        get { state.selected == index }
        set { if newValue != (state.selected == index) { select(index) } }
    }

    /// Selects piece `index`, or lets it go when it is already selected. One piece is the whole
    /// recording, which shows no band to select.
    func togglePiece(_ index: Int) {
        guard !state.cuts.isEmpty, state.pieces.indices.contains(index) else { return }
        selectedPiece = selectedPiece == index ? nil : index
    }

    /// A tap at `x` points on the zoomed strip: toggles the piece there.
    func tapPiece(atX x: Double) {
        guard let view = zoomedView(centerMs: shownLineMs) else { return }
        let ms = Int64(view.sourceMs(atX: x).rounded())
        guard bounds.contains(ms) else { return }
        togglePiece(state.pieceIndex(at: ms))
    }

    /// Moves cut `index` alone to `ms`, within the room that keeps every piece at least a second
    /// long, leaving the line where it is.
    func moveCut(_ index: Int, to ms: Int64) {
        guard state.cuts.indices.contains(index) else { return }
        let was = state.cuts[index]
        apply(.moveCut(index: index, ms: ms))
        // Playback bound for this cut stops wherever it now is.
        if stopAtMs == was { setStop(state.cuts[index]) }
    }

    /// Moves cut `index` by `deltaMs`, as the arrows and VoiceOver do on its handle, and brings it
    /// into view.
    func nudgeCut(_ index: Int, by deltaMs: Int64) {
        guard state.cuts.indices.contains(index) else { return }
        moveCut(index, to: state.cuts[index] + deltaMs)
        reveal(state.cuts[index])
    }

    /// What VoiceOver reads for cut `index`'s handle: its precise time.
    func cutValue(_ index: Int) -> String {
        guard state.cuts.indices.contains(index) else { return "" }
        return RecordingScreenText.preciseTime(milliseconds: state.cuts[index] - bounds.lowerBound)
    }

    /// Moves the line just far enough to bring `sourceMs` into the strip's view, letting go of a
    /// selected cut.
    func reveal(_ sourceMs: Int64) {
        guard let pointsPerSecond else { return }
        let reach = Int64((max(0, width / 2 - PracticeModel.autoPanZone) / pointsPerSecond * 1000).rounded())
        let off = sourceMs - shownLineMs
        if off > reach {
            pan(byMs: off - reach)
        } else if off < -reach {
            pan(byMs: off + reach)
        }
    }

    // MARK: Cut handles

    /// A drag on cut `index`'s handle has passed the threshold.
    func beginCutDrag(_ index: Int) {
        guard state.cuts.indices.contains(index) else { return }
        cutDrag = CutDrag(index: index, originMs: state.cuts[index])
    }

    /// The handle's drag is now at `x` points from the strip's left edge. It snaps to the line
    /// and to the ends of the cut's room unless `snapping` is off.
    func dragCut(toX x: Double, snapping: Bool) {
        guard var drag = cutDrag, !drag.cancelled, let view = zoomedView(centerMs: shownLineMs) else { return }
        drag.lastX = x
        drag.snapping = snapping
        drag.moved = true
        let room = state.cutRoom(for: drag.index)
        let pointer = Int64(view.sourceMs(atX: x).rounded())
        let targets = (snapping ? [shownLineMs] : []) + [room.min, room.max]
        let snapped = LoopModel.snap(pointer, to: targets, msPerPoint: 1000 / view.pointsPerSecond)
        let landed = snapping && (snapped != pointer || targets.contains(pointer)) ? snapped : nil
        if let landed, landed != drag.snappedTo { cutSnaps += 1 }
        drag.snappedTo = landed
        cutDrag = drag
        moveCut(drag.index, to: snapped)
        let depth = autoPanDepth(atX: x)
        if depth != autoPan { autoPan = depth }
    }

    func endCutDrag(atX x: Double, snapping: Bool) {
        guard let drag = cutDrag else { return }
        if drag.moved, !drag.cancelled { dragCut(toX: x, snapping: snapping) }
        finishCutDrag()
    }

    /// A drag the system took away: the cut goes back to where the drag began.
    func cancelCutDrag() {
        guard let drag = cutDrag else { return }
        finishCutDrag()
        if !drag.cancelled { moveCut(drag.index, to: drag.originMs) }
    }

    /// One step of auto-pan, faster deeper into the zone, then the drag again against the view
    /// that moved under it.
    func autoPanStep() {
        guard autoPan != 0, let drag = cutDrag, let pointsPerSecond else { return }
        pan(byMs: Int64((autoPan * PracticeModel.autoPanMax * 1000 / pointsPerSecond).rounded()))
        dragCut(toX: drag.lastX, snapping: drag.snapping)
    }

    private func finishCutDrag() {
        cutDrag = nil
        if autoPan != 0 { autoPan = 0 }
    }

    /// Moves the line alone by `deltaMs`, as a handle dragged to the strip's edge does, letting go
    /// of a selected cut.
    private func pan(byMs deltaMs: Int64) {
        holdForEdit()
        apply(.seek(state.lineMs + deltaMs))
    }

    private func autoPanDepth(atX x: Double) -> Double {
        let zone = PracticeModel.autoPanZone
        guard width > 0 else { return 0 }
        if x < zone { return -(zone - max(0, x)) / zone }
        if x > width - zone { return (zone - max(0, width - x)) / zone }
        return 0
    }

    func previous() {
        holdForEdit()
        apply(.previous)
    }

    func next() {
        holdForEdit()
        apply(.next)
    }

    // MARK: The zoomed strip

    /// Starts a drag of the zoomed strip, which holds playback.
    func beginScrub() {
        holdForEdit()
        scrubOrigin = (state.lineMs, state)
        scrubCancelled = false
    }

    /// Moves the line `deltaMs` from where the drag began.
    func scrub(byMs deltaMs: Int64) {
        guard !scrubCancelled, let scrubOrigin else { return }
        apply(.moveLine(scrubOrigin.lineMs + deltaMs))
    }

    /// Moves the line by `deltaMs` for a trackpad's sideways scroll, which holds playback.
    func scrub(byScrollMs deltaMs: Int64) {
        holdForEdit()
        apply(.moveLine(state.lineMs + deltaMs))
        apply(.rest)
    }

    func endScrub() {
        if scrubOrigin != nil, !scrubCancelled { apply(.rest) }
        scrubOrigin = nil
    }

    /// The scale in points per second, or nil until the strip has a width.
    var pointsPerSecond: Double? {
        guard width > 0 else { return nil }
        return chosenPointsPerSecond
            ?? PracticeZoom.zoomScale(width / (PracticeZoom.openingSpanMs / 1000), by: 1, frame: zoomFrame)
    }

    var canZoomIn: Bool { pointsPerSecond.map { $0 < PracticeZoom.maxPointsPerSecond } ?? false }
    var canZoomOut: Bool {
        pointsPerSecond.map { $0 > PracticeZoom.minPointsPerSecond(width: width, lengthMs: zoomFrame.lengthMs) }
            ?? false
    }

    func zoom(by factor: Double) {
        guard let pointsPerSecond else { return }
        chosenPointsPerSecond = PracticeZoom.zoomScale(pointsPerSecond, by: factor, frame: zoomFrame)
    }

    /// Zooms to `magnification` of the scale the pinch began at. A pinch begins with one finger,
    /// which has already dragged by the time the second lands, so the first change puts that
    /// drag back and ends it.
    func pinch(_ magnification: Double) {
        if pinchBase == nil {
            pinchBase = pointsPerSecond
            if var drag = cutDrag, !drag.cancelled {
                drag.cancelled = true
                cutDrag = drag
                if autoPan != 0 { autoPan = 0 }
                moveCut(drag.index, to: drag.originMs)
            }
            if let scrubOrigin, !scrubCancelled {
                state = scrubOrigin.state
                syncTransport()
                scrubCancelled = true
            }
        }
        guard let pinchBase else { return }
        chosenPointsPerSecond = PracticeZoom.zoomScale(pinchBase, by: magnification, frame: zoomFrame)
    }

    func endPinch() {
        pinchBase = nil
    }

    /// The zoomed strip's view, centered on `centerMs` on the source timeline.
    func zoomedView(centerMs: Int64) -> ZoomedWaveformView? {
        pointsPerSecond.map {
            PracticeZoom.view(
                pointsPerSecond: $0, centerMs: centerMs - bounds.lowerBound, width: width,
                trimStartMs: bounds.lowerBound)
        }
    }

    private var zoomFrame: ZoomFrame {
        ZoomFrame(width: width, lengthMs: Double(bounds.upperBound - bounds.lowerBound))
    }

    // MARK: Lifecycle

    /// Plays at normal speed and pitch while the screen shows, so what is heard is exactly where
    /// a cut falls.
    func open() {
        guard !hasLeft, !isHolding else { return }
        isHolding = true
        hold(PlaybackSettings(speedPercent: 100, pitchCents: 0))
    }

    /// Gives way: the question goes, the hold is let go, and nothing is written after.
    func leave() {
        isConfirming = false
        hasLeft = true
        setStop(nil)
        guard isHolding else { return }
        isHolding = false
        hold(nil)
    }

    /// Whether the screen must give way to a trim from elsewhere: once one has landed and no
    /// write of its own is under way, whose outcome it waits for.
    var mustGiveWay: Bool { isStale && !isSaving && !hasLeft }

    /// Reads the recording's row as it is now, noting a trim from elsewhere, and returns
    /// ``mustGiveWay``. The screen's own write landing is not one.
    @discardableResult
    func follow(_ row: Recording) -> Bool {
        guard !hasLeft, row.id == recordingID else { return false }
        let now = TrimModel.Patch(trimStartMs: row.trimStartMs, trimEndMs: row.trimEndMs)
        if now != opened && now != writing { isStale = true }
        return mustGiveWay
    }

    /// Writes the split once, sends `recording_split`, and leaves, returning whether it wrote.
    /// Writes nothing without a valid split, after a trim from elsewhere, or once the screen has
    /// given way. A failed write stays to be tried again.
    @discardableResult
    func save() async throws -> Bool {
        guard state.canSave, !isSaving, !hasLeft, !isStale else { return false }
        isConfirming = false
        isSaving = true
        let cuts = state.cuts
        writing = TrimModel.Patch(trimStartMs: opened.trimStartMs, trimEndMs: cuts[0])
        defer { writing = nil }
        do {
            try await write(recordingID, cuts)
        } catch {
            isSaving = false
            throw error
        }
        analytics.send(
            .recordingSplit(recordingID: recordingID, pieceCount: cuts.count + 1, overLimit: state.overLimit))
        leave()
        return true
    }

    // MARK: Private

    private func seconds(_ ms: Int64) -> TimeInterval {
        TimeInterval(ms - bounds.lowerBound) / 1000
    }

    /// Pauses for an edit, which then starts from where playback was.
    private func holdForEdit() {
        guard isPlaying else { return }
        let at = playheadMs
        pause()
        apply(.seek(at))
    }

    private func pause() {
        believesPlaying = false
        lastPlayingElapsed = nil
        transport?.pause()
        setStop(nil)
    }

    private func apply(_ action: State.Action) {
        let next = state.applying(action)
        guard next != state else { return }
        state = next
        syncTransport()
    }

    /// While paused the player is held at the line, so Play starts there.
    private func syncTransport() {
        guard let transport, !transport.isPlaying else { return }
        transport.seek(to: seconds(state.lineMs))
    }
}
