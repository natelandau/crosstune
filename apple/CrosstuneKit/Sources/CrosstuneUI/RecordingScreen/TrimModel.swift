import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import Foundation
import Observation

/// The trim screen's handles and the one write it makes. Every value in ms is on the source
/// timeline; the audio player counts seconds from `bounds.lowerBound`.
///
/// The handles start on the row's current trim and cannot leave it, so a trim only narrows,
/// and never come nearer each other than ``RecordingLimits/minLengthMs``.
@MainActor
@Observable
final class TrimModel {
    enum Handle: Hashable, CaseIterable {
        case start
        case end
    }

    /// Writes the trim to recording `recordingID`'s row.
    typealias Write = @MainActor (_ recordingID: String, _ trimStartMs: Int64, _ trimEndMs: Int64?) async throws -> Void
    /// Plays `settings` in place of the recording's own speed and pitch, or lets go with nil.
    typealias Hold = @MainActor (_ settings: PlaybackSettings?) -> Void

    /// What Save does: closes the screen when nothing changed, or asks before writing.
    enum SaveAction: Equatable {
        case close
        case confirm
    }

    /// A drag of the handles: where they were as it began, which a pinch that takes over puts
    /// back, and the detail's window then, held while the drag is in the detail so the bars stay
    /// still under the finger.
    struct HandleDrag: Equatable {
        let originStart: Int64
        let originEnd: Int64
        let heldWindow: ClosedRange<Double>?
        /// Set once a pinch has taken over, after which the drag moves nothing.
        var isCancelled = false
    }

    /// The trim as written: an end of nil runs to the source end.
    struct Patch: Equatable {
        let trimStartMs: Int64
        let trimEndMs: Int64?
    }

    /// The shortest stretch the detail waveform zooms in to.
    static let minDetailMs: Int64 = 2000
    /// How much the detail waveform shows when the screen opens.
    static let openingDetailMs: Int64 = 10_000
    /// How much Preview end plays before the end handle.
    static let previewMs: Int64 = 3000

    let recordingID: String
    /// The row's trim when the screen opened, which the handles cannot leave.
    let bounds: ClosedRange<Int64>
    private(set) var start: Int64
    private(set) var end: Int64
    /// The handle the detail waveform follows.
    private(set) var focus: Handle = .start
    /// How many times narrower than `bounds` the detail waveform is; 1 shows it all.
    private(set) var zoom: Double
    /// Whether the Save question is up.
    var isConfirming = false
    private(set) var isSaving = false
    /// Set once the screen has given way, after which it writes and holds nothing.
    private(set) var hasLeft = false
    /// Set once the row's trim has changed from elsewhere. The handles and every seek count
    /// from the trim the screen opened on, so it writes nothing after, lest it cut the recording
    /// somewhere the musician did not choose or widen a trim made since.
    private(set) var isStale = false
    /// Set when a pinch takes over a seek begun with one finger, so that finger's seek comes to
    /// nothing.
    @ObservationIgnored private(set) var seekCancelled = false
    /// The handle drag under way.
    private(set) var handleDrag: HandleDrag?

    /// The row's trim when the screen opened.
    @ObservationIgnored private let opened: Patch
    /// The trim being written, which the row shows once the write lands.
    @ObservationIgnored private var writing: Patch?
    @ObservationIgnored private let write: Write
    @ObservationIgnored private let hold: Hold
    @ObservationIgnored private let analytics: AnalyticsClient
    @ObservationIgnored private var isHolding = false
    @ObservationIgnored private var isSeeking = false
    @ObservationIgnored private var pinchBase: Double?

    init(
        recording: Recording, file: RecordingFile?, write: @escaping Write, hold: @escaping Hold,
        analytics: AnalyticsClient = .noop
    ) {
        self.analytics = analytics
        recordingID = recording.id
        let low = recording.trimStartMs
        let endMs = RecordingLimits.sourceEndMs(recording, file: file) ?? low
        bounds = low...max(low, endMs)
        start = bounds.lowerBound
        end = bounds.upperBound
        opened = Patch(trimStartMs: recording.trimStartMs, trimEndMs: recording.trimEndMs)
        self.write = write
        self.hold = hold
        zoom = 1
        zoom = clampedZoom(Double(span) / Double(Self.openingDetailMs))
    }

    private var span: Int64 { bounds.upperBound - bounds.lowerBound }

    /// The most the detail can zoom, where it shows ``minDetailMs``.
    var maxZoom: Double { max(1, Double(span) / Double(Self.minDetailMs)) }
    var canZoomIn: Bool { zoom < maxZoom }
    var canZoomOut: Bool { zoom > 1 }
    var length: Int64 { end - start }

    /// True once either handle has left the row's current trim.
    var isChanged: Bool { start != bounds.lowerBound || end != bounds.upperBound }

    /// The trim to write. An end left on the source end stays nil when the row had none, so the
    /// row goes on meaning "to the end" rather than naming a length the server may measure
    /// differently.
    var patch: Patch {
        let keepsOpenEnd = opened.trimEndMs == nil && end == bounds.upperBound
        return Patch(trimStartMs: start, trimEndMs: keepsOpenEnd ? nil : end)
    }

    func value(_ handle: Handle) -> Int64 {
        handle == .start ? start : end
    }

    func select(_ handle: Handle) {
        if focus != handle { focus = handle }
    }

    func drag(_ handle: Handle, to ms: Double) {
        place(handle, Int64(ms.rounded()))
    }

    func nudge(_ handle: Handle, by deltaMs: Int64) {
        place(handle, value(handle) + deltaMs)
    }

    func zoom(by factor: Double) {
        zoom = clampedZoom(zoom * factor)
    }

    /// Shows the whole range in the detail waveform.
    func fit() {
        zoom = 1
    }

    /// The stretch of the source the detail waveform shows: centered on `center` (the focused
    /// handle by default), as wide as the zoom allows, and kept inside the bounds.
    func detailWindow(center: Double? = nil) -> ClosedRange<Double> {
        let low = Double(bounds.lowerBound)
        let high = Double(bounds.upperBound)
        let width = min(high - low, max(Double(Self.minDetailMs), (high - low) / zoom))
        let middle = center ?? Double(value(focus))
        let from = min(max(middle - width / 2, low), high - width)
        return from...(from + width)
    }

    /// The stretch the detail waveform shows now: the window a drag in it holds, or else
    /// ``detailWindow(center:)``. A pinch that took the drag over lets go of the window, so the
    /// detail follows the zoom.
    var shownDetailWindow: ClosedRange<Double> {
        guard let handleDrag, !handleDrag.isCancelled, let held = handleDrag.heldWindow else { return detailWindow() }
        return held
    }

    /// `sourceMs` as the handles place it: seconds from the start of `bounds`.
    func handleSeconds(_ sourceMs: Int64) -> Double {
        HandleTime.seconds(sourceMs, from: bounds.lowerBound)
    }

    /// A handle's place, in seconds from the start of `bounds`, as a time in the source.
    func sourceMs(handleSeconds seconds: Double) -> Int64 {
        HandleTime.sourceMs(seconds, from: bounds.lowerBound)
    }

    // MARK: Gestures

    /// Starts a press on the waveform that seeks where it ends.
    func beginSeek() {
        isSeeking = true
        seekCancelled = false
    }

    func endSeek() {
        isSeeking = false
    }

    /// The handles moved to `startMs` and `endMs` by a drag or a VoiceOver step. The first move
    /// of a drag notes where the handles were, and with `holdsDetail` the detail's window, which
    /// stays until ``commitHandles()``.
    func moveHandles(startMs: Int64, endMs: Int64, holdsDetail: Bool) {
        if handleDrag == nil {
            handleDrag = HandleDrag(
                originStart: start, originEnd: end, heldWindow: holdsDetail ? detailWindow() : nil)
        }
        guard handleDrag?.isCancelled == false else { return }
        stepHandles(startMs: startMs, endMs: endMs)
    }

    /// The handles moved by an arrow key, which holds no window, so the detail follows the
    /// handle it moves.
    func stepHandles(startMs: Int64, endMs: Int64) {
        if startMs != start { place(.start, startMs) }
        if endMs != end { place(.end, endMs) }
    }

    /// The drag or the run of steps under way has ended where it left the handles.
    func commitHandles() {
        handleDrag = nil
    }

    /// Makes the handle nearer `ms` the one the detail follows, as a tap on a handle does.
    func selectHandle(nearestMs ms: Int64) {
        select(abs(ms - start) <= abs(ms - end) ? .start : .end)
    }

    /// Zooms to `magnification` of the zoom the pinch began at. A pinch begins with one finger,
    /// which has already dragged a handle or begun a seek by the time the second lands, so the
    /// first change puts the handles back and ends that finger's gesture.
    func pinch(_ magnification: Double) {
        if pinchBase == nil {
            pinchBase = zoom
            if var drag = handleDrag, !drag.isCancelled {
                start = drag.originStart
                end = drag.originEnd
                drag.isCancelled = true
                handleDrag = drag
            }
            if isSeeking { seekCancelled = true }
        }
        zoom = clampedZoom((pinchBase ?? zoom) * magnification)
    }

    func endPinch() {
        pinchBase = nil
    }

    // MARK: Lifecycle

    /// Plays ``PlaybackSettings/normal`` while the screen shows, so what is heard is what is cut.
    func open() {
        guard !hasLeft, !isHolding else { return }
        isHolding = true
        hold(.normal)
    }

    /// Gives way: the question goes, the hold is let go, and nothing is written after.
    func leave() {
        isConfirming = false
        hasLeft = true
        guard isHolding else { return }
        isHolding = false
        hold(nil)
    }

    /// Whether the screen must give way to a trim from elsewhere: once one has landed and no
    /// write of its own is under way, whose outcome it waits for.
    var mustGiveWay: Bool { isStale && !isSaving && !hasLeft }

    /// Takes the recording's row as it is now, noting a trim from elsewhere, and returns
    /// ``mustGiveWay``. The screen's own write landing is not one.
    @discardableResult
    func follow(_ row: Recording) -> Bool {
        guard !hasLeft, row.id == recordingID else { return false }
        let now = Patch(trimStartMs: row.trimStartMs, trimEndMs: row.trimEndMs)
        if now != opened && now != writing { isStale = true }
        return mustGiveWay
    }

    /// What a press on Save does. With a handle moved it asks before writing; with none moved
    /// there is nothing to write, so the screen closes.
    func pressSave() -> SaveAction {
        guard isChanged else { return .close }
        isConfirming = true
        return .confirm
    }

    /// Writes the handles as they are, once, and leaves, returning whether it wrote. Writes
    /// nothing when no handle has moved, the trim has changed from elsewhere, or the screen has
    /// already given way. A failed write stays to be tried again.
    @discardableResult
    func save() async throws -> Bool {
        guard isChanged, !isSaving, !hasLeft, !isStale else { return false }
        isConfirming = false
        isSaving = true
        let patch = patch
        writing = patch
        defer { writing = nil }
        do {
            try await write(recordingID, patch.trimStartMs, patch.trimEndMs)
        } catch {
            isSaving = false
            throw error
        }
        analytics.send(.recordingTrimmed(recordingID: recordingID))
        leave()
        return true
    }

    // MARK: Rules

    /// `handle` moved as near `ms` as the bounds and the shortest kept range allow.
    private func place(_ handle: Handle, _ ms: Int64) {
        let low = bounds.lowerBound
        let high = bounds.upperBound
        switch handle {
        case .start:
            start = min(max(ms, low), max(low, end - RecordingLimits.minLengthMs))
        case .end:
            end = min(max(ms, min(high, start + RecordingLimits.minLengthMs)), high)
        }
        select(handle)
    }

    private func clampedZoom(_ value: Double) -> Double {
        min(max(value, 1), maxZoom)
    }
}

/// Stops Play selection and Preview end on the end handle. It reads the handle as it is at
/// each position the player reports, so moving the handle while playing moves the stop.
struct SelectionStop: Equatable {
    enum Action: Equatable {
        case none
        /// Pause and move to `at`, the end handle.
        case stop(at: TimeInterval)
        /// The player ran off the window's end and went back to its start; move to `at`, the
        /// end handle, so the playhead stays where the selection ended.
        case park(at: TimeInterval)
    }

    /// The player reports its position once a tick, so stopping within half a tick of the handle
    /// lands nearer it than waiting a whole one.
    static let early = AudioPlayer.tick / 2

    private(set) var isArmed = false
    /// The last position seen while playing.
    private var lastPlaying: TimeInterval?

    mutating func arm() {
        isArmed = true
        lastPlaying = nil
    }

    mutating func disarm() {
        isArmed = false
        lastPlaying = nil
    }

    /// What to do on a reading of the player, with the end handle `end` seconds into a window
    /// `length` long.
    mutating func observe(playing: Bool, elapsed: TimeInterval, end: TimeInterval, length: TimeInterval) -> Action {
        guard isArmed else { return .none }
        if playing {
            if elapsed >= end - Self.early {
                disarm()
                return .stop(at: end)
            }
            lastPlaying = elapsed
            return .none
        }
        // Not yet playing: the play that armed this has not been reported.
        guard let last = lastPlaying else { return .none }
        disarm()
        // The player returns to the start on reaching the window's end, and only there. A pause
        // of its own never moves the position back, so a pause at a start of 0 is not this.
        let ranOff =
            end >= length - Self.early && elapsed == 0 && elapsed < last
            && last >= end - AudioPlayer.tick - Self.early
        return ranOff ? .park(at: end) : .none
    }
}
