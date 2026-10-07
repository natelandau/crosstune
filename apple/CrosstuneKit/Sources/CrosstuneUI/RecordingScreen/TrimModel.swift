import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneStore
import Foundation
import Observation

/// The trim screen's handles and the one write it makes. Every value in ms is on the source
/// timeline; the audio player counts seconds from `bounds.lowerBound`.
///
/// The handles start on the row's current trim and cannot leave it, so a trim only narrows,
/// and never come nearer each other than ``minTrimMs``.
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

    /// The trim as written: an end of nil runs to the source end.
    struct Patch: Equatable {
        let trimStartMs: Int64
        let trimEndMs: Int64?
    }

    /// The shortest kept range, as `MIN_TRIM_MS` in `api/src/crosstune/vocabulary.py` enforces.
    static let minTrimMs: Int64 = 1000
    /// The shortest stretch the detail waveform zooms in to.
    static let minDetailMs: Int64 = 2000
    /// How much the detail waveform shows when the screen opens.
    static let openingDetailMs: Int64 = 10_000
    static let nudgeMs: Int64 = 100
    static let largeNudgeMs: Int64 = 1000
    static let zoomStep = 2.0
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
    /// Set when a pinch takes over a gesture begun with one finger, so that finger's drag or
    /// seek comes to nothing.
    private(set) var gestureCancelled = false
    /// The handle the gesture under way drags, or nil when it seeks.
    @ObservationIgnored private(set) var gestureHandle: Handle?

    /// The row's trim when the screen opened.
    @ObservationIgnored private let opened: Patch
    /// The trim being written, which the row shows once the write lands.
    @ObservationIgnored private var writing: Patch?
    @ObservationIgnored private let write: Write
    @ObservationIgnored private let hold: Hold
    @ObservationIgnored private let analytics: AnalyticsClient
    @ObservationIgnored private var isHolding = false
    /// Where the handles stood when the gesture under way began.
    @ObservationIgnored private var gestureOrigin: (start: Int64, end: Int64)?
    @ObservationIgnored private var pinchBase: Double?

    init(
        recording: Recording, file: RecordingFile?, write: @escaping Write, hold: @escaping Hold,
        analytics: AnalyticsClient = .noop
    ) {
        self.analytics = analytics
        recordingID = recording.id
        let low = recording.trimStartMs
        let endMs = recording.trimEndMs ?? recording.sourceDurationMs ?? file?.localDurationMs ?? low
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

    /// Puts `handle` at the playhead. A playhead too near the other handle is a mistimed tap, so
    /// it moves nothing rather than landing the handle somewhere the musician did not choose.
    func setAtPlayhead(_ handle: Handle, playheadMs: Int64) {
        let tooNear =
            handle == .start ? playheadMs > end - Self.minTrimMs : playheadMs < start + Self.minTrimMs
        if !tooNear { place(handle, playheadMs) }
    }

    func zoom(by factor: Double) {
        zoom = clampedZoom(zoom * factor)
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

    // MARK: Gestures

    /// Starts a gesture that drags `handle`, or seeks when nil, noting where the handles stand
    /// for a pinch that follows to put back.
    func beginGesture(on handle: Handle?) {
        gestureOrigin = (start, end)
        gestureHandle = handle
        gestureCancelled = false
        if let handle { select(handle) }
    }

    func endGesture() {
        gestureOrigin = nil
        gestureHandle = nil
    }

    /// Zooms to `magnification` of the zoom the pinch began at. A pinch begins with one finger,
    /// which has already dragged a handle by the time the second lands, so the first change puts
    /// the handles back and ends that finger's gesture.
    func pinch(_ magnification: Double) {
        if pinchBase == nil {
            pinchBase = zoom
            if let gestureOrigin {
                start = gestureOrigin.start
                end = gestureOrigin.end
                gestureCancelled = true
            }
        }
        zoom = clampedZoom((pinchBase ?? zoom) * magnification)
    }

    func endPinch() {
        pinchBase = nil
    }

    // MARK: Lifecycle

    /// Plays at normal speed and pitch while the screen shows, so what is heard is what is cut.
    func open() {
        guard !hasLeft, !isHolding else { return }
        isHolding = true
        hold(PlaybackSettings(speedPercent: 100, pitchCents: 0))
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

    /// Takes the recording's row as it now stands, noting a trim from elsewhere, and returns
    /// ``mustGiveWay``. The screen's own write landing is not one.
    @discardableResult
    func follow(_ row: Recording) -> Bool {
        guard !hasLeft, row.id == recordingID else { return false }
        let now = Patch(trimStartMs: row.trimStartMs, trimEndMs: row.trimEndMs)
        if now != opened && now != writing { isStale = true }
        return mustGiveWay
    }

    /// Writes the handles as they stand, once, and leaves, returning whether it wrote. Writes
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
        analytics.send(.recordingTrimmed)
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
            start = min(max(ms, low), max(low, end - Self.minTrimMs))
        case .end:
            end = min(max(ms, min(high, start + Self.minTrimMs)), high)
        }
        select(handle)
    }

    private func clampedZoom(_ value: Double) -> Double {
        min(max(value, 1), maxZoom)
    }
}

/// Stops Play selection and Preview end on the end handle. It reads the handle as it stands on
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
