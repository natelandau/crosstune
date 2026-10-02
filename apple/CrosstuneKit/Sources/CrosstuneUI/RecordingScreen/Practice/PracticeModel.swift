import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import Foundation
import Observation
import SwiftUI

/// The writes the recording screen makes to a recording's loops.
struct LoopWriter {
    var add: @MainActor (_ recordingID: String, _ span: LoopSpan) async throws -> RecordingLoop
    /// Changes a loop's span when `span` is set, and its label as `label` says.
    var update: @MainActor (_ id: String, _ span: LoopSpan?, _ label: Patch<String?>) async throws -> Void
    var remove: @MainActor (_ id: String) async throws -> Void

    static func commands(_ commands: CrosstuneCommands.Commands) -> LoopWriter {
        LoopWriter(
            add: { try await commands.addLoop(recordingID: $0, startMs: $1.startMs, endMs: $1.endMs) },
            update: { id, span, label in
                try await commands.updateLoop(
                    id, startMs: span.map { .value($0.startMs) } ?? .keep,
                    endMs: span.map { .value($0.endMs) } ?? .keep,
                    label: label)
            },
            remove: { try await commands.removeLoop($0) })
    }
}

/// The loaded recording on its screen: the waveform under a fixed playhead, its zoom and
/// scrubbing, the loops drawn on it, and naming them. The selection, which is what repeats,
/// belongs to the player's ``LoopPlayback``, so it outlives this screen. Every loop write is one
/// per finished action, made when the gesture or key ends; none can be undone.
///
/// The waveform's state lives in `PracticeModel+Waveform.swift`, the loop commands and handles
/// in `PracticeModel+Loops.swift`.
@MainActor
@Observable
final class PracticeModel {
    /// A loop shown ahead of its row. `base` is the row's span when the draft began. `sent`
    /// holds the spans already written for it, which the row can pass through on its way to the
    /// latest.
    struct Draft: Equatable {
        var span: LoopSpan
        var base: LoopSpan?
        var sent: [LoopSpan] = []
    }

    /// A drag on one of the selected loop's handles.
    struct HandleDrag {
        let id: String
        let edge: LoopModel.Edge
        /// The loop's span when the drag began.
        let origin: LoopSpan
        /// The free span around the loop, which the edge never leaves.
        let room: LoopSpan
        /// The pinch count when it began; a pinch since puts the loop back unwritten.
        let pinch: Int
        var lastX: Double = 0
        var snapping = true
        var moved = false
        /// The time the last snap landed on, so each new snap plays one haptic.
        var snappedTo: Int64?
    }

    /// A drag on the waveform past the threshold, which holds playback until it settles.
    struct Scrub {
        var originMs: Int64
        var pinch: Int
        let wasPlaying: Bool
    }

    static let nudgeMs: Int64 = 100
    static let largeNudgeMs: Int64 = 1000
    static let arrowStepMs: Int64 = 1000
    static let arrowLargeStepMs: Int64 = 5000
    static let zoomStep = 2.0

    let player: PlayerModel
    private(set) var recording: Recording
    private(set) var file: RecordingFile?
    /// The recording's tune's part structure, for name suggestions.
    var partStructure: String?
    /// The mode whose controls show under the waveform, which the mode panel reads and sets;
    /// the screen keeps it as device state.
    var mode: PracticeMode
    private(set) var drafts: [String: Draft] = [:]
    /// The draft a gesture or a held key is still drawing, which waits for it to end.
    var activeKey: String?
    /// The loop whose name field is open.
    private(set) var renaming: String?
    /// Why the last loop write did not land.
    var failure: String?
    /// Counts snaps, so each one can play a haptic.
    var snaps = 0

    /// The view's width in points; 0 until measured.
    var width: Double = 0
    /// The zoom, held as set; ``scale`` keeps it within what the view's width allows.
    var pointsPerSecond: Double?
    /// The playhead while a drag or its glide moves it, on the trimmed timeline; playback seeks
    /// there once it settles.
    var scrubbingMs: Int64?
    /// How deep a handle's drag is into either end's auto-pan zone, from -1 at the left edge to
    /// 1 at the right; 0 outside both.
    var autoPan: Double = 0

    @ObservationIgnored let writer: LoopWriter
    @ObservationIgnored let clock: () -> ContinuousClock.Instant
    @ObservationIgnored let announce: (String) -> Void
    @ObservationIgnored var handleDrag: HandleDrag?
    @ObservationIgnored var activeScrub: Scrub?
    @ObservationIgnored var glide: Task<Void, Never>?
    /// How long a released drag coasts: three time constants, where 95% of its distance is covered.
    @ObservationIgnored var glideRun: Duration = .milliseconds(3 * PracticeZoom.glideTauMs)
    @ObservationIgnored var pinches = 0
    @ObservationIgnored var pinchBase: Double?
    /// The player's last reported position and when it came, which the playhead runs on from
    /// between the player's reports.
    @ObservationIgnored var reading: (elapsed: TimeInterval, at: ContinuousClock.Instant)?
    @ObservationIgnored var nudging: (id: String, origin: LoopSpan)?
    /// A name field's text waiting to be written after the field lost focus.
    @ObservationIgnored private var blurred: Task<Void, Never>?
    @ObservationIgnored private var blurredText: String?
    /// How long a name field that lost focus waits before it writes, so a suggestion chip
    /// whose press took the focus away writes its own name instead.
    @ObservationIgnored var blurDelay: Duration = .milliseconds(300)
    @ObservationIgnored private var renameOpened = ""
    /// What the open name field holds, so a touch elsewhere can save it without waiting on focus.
    @ObservationIgnored private var renameDraft: String?
    @ObservationIgnored private var writes: [UUID: Task<Void, Never>] = [:]

    init(
        player: PlayerModel, recording: Recording, file: RecordingFile?, writer: LoopWriter,
        mode: PracticeMode = .loops,
        clock: @escaping () -> ContinuousClock.Instant = { .now },
        announce: @escaping (String) -> Void = { AccessibilityNotification.Announcement($0).post() }
    ) {
        self.player = player
        self.recording = recording
        self.file = file
        self.writer = writer
        self.mode = mode
        self.clock = clock
        self.announce = announce
    }

    // MARK: The recording

    var trimStartMs: Int64 { recording.trimStartMs }

    var isLoaded: Bool { player.recordingAudio == .loaded && !player.audio.hasFailed }

    /// The trimmed recording's length: the player's once its audio is loaded, else the row's,
    /// and 0 while nothing says how long it is.
    var lengthMs: Int64 {
        if isLoaded, let duration = player.audio.duration { return Int64((duration * 1000).rounded()) }
        guard let end = recording.trimEndMs ?? recording.sourceDurationMs ?? file?.localDurationMs else { return 0 }
        return max(0, end - trimStartMs)
    }

    /// The trim range on the source timeline, which no loop leaves.
    var bounds: LoopSpan { LoopSpan(startMs: trimStartMs, endMs: trimStartMs + lengthMs) }

    /// The playhead on the trimmed timeline.
    var positionMs: Double { isLoaded ? player.audio.elapsed * 1000 : 0 }

    /// The playhead on the source timeline where it shows, a scrub or glide under way
    /// included, which is where every loop command acts.
    var playheadMs: Int64 { trimStartMs + centerMs }

    /// Takes the recording's row and file as they now stand.
    func follow(_ recording: Recording, file: RecordingFile?) {
        if recording != self.recording { self.recording = recording }
        if file != self.file { self.file = file }
        ensureZoom()
    }

    // MARK: Loops and selection

    var loops: [RecordingLoop] { player.loops.rows }
    var selectedID: String? { player.loops.selectedID }
    var selected: RecordingLoop? { player.loops.selected }
    var isRepeating: Bool { player.loops.isRepeating }

    func name(_ loop: RecordingLoop) -> String {
        LoopModel.name(label: loop.label, startMs: loop.startMs, trimStartMs: trimStartMs)
    }

    /// Selects loop `id`, which then repeats, or none, which plays on.
    func select(_ id: String?) {
        player.loops.select(id)
    }

    /// Loop `id`'s row, the selected loop's included while the live rows catch up with it.
    func row(_ id: String) -> RecordingLoop? {
        loops.first { $0.id == id } ?? (selected?.id == id ? selected : nil)
    }

    /// The span a loop shows: its draft until the row has caught up, else its row.
    func shownSpan(_ id: String) -> LoopSpan? {
        let row = row(id).map(Self.span)
        guard let draft = drafts[id] else { return row }
        guard let row else { return draft.span }
        return hasLanded(id, draft) ? row : draft.span
    }

    /// Whether loop `id`'s row has caught up with `draft`: it holds the drafted span, or it has
    /// moved off `base` (a write, this device's or a newer one, has landed) and no gesture is
    /// still drawing it.
    private func hasLanded(_ id: String, _ draft: Draft) -> Bool {
        guard let row = row(id).map(Self.span) else { return false }
        if row == draft.span { return true }
        return id != activeKey && draft.base != row && !draft.sent.contains(row)
    }

    static func span(_ loop: RecordingLoop) -> LoopSpan {
        LoopSpan(startMs: loop.startMs, endMs: loop.endMs)
    }

    // MARK: Rename

    /// What loop `id`'s name field opens with: its stored label, empty for an unnamed loop.
    func renameText(_ id: String) -> String {
        row(id)?.label ?? ""
    }

    func beginRename(_ id: String) {
        guard let row = row(id) else { return }
        // A field that just lost focus writes to its own loop before another field opens.
        flushBlur()
        renameOpened = row.label ?? ""
        renameDraft = nil
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
        guard trimmed != opened, row(id) != nil else { return }
        let label = trimmed.isEmpty ? nil : trimmed
        run { [self] in
            do { try await writer.update(id, nil, .value(label)) } catch { report(error) }
        }
    }

    /// The name field now holds `text`.
    func renameTyped(_ text: String) {
        renameDraft = text
    }

    /// A touch elsewhere on the screen: saves what the open name field holds and closes it.
    func saveOpenRename() {
        guard renaming != nil else { return }
        commitRename(renameDraft ?? renameOpened)
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
        return row(id) != nil
    }

    /// Names for loop `id` from the tune's parts, with labels other loops use last.
    func suggestions(for id: String) -> [String] {
        let used = loops.filter { $0.id != id }.compactMap {
            $0.label?.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty }
        return LoopModel.partSuggestions(partStructure: partStructure, used: used)
    }

    // MARK: Writes

    /// Writes loop `id`'s new span, shown and played ahead of its row until the row catches up.
    func write(_ id: String, _ span: LoopSpan) {
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
    }

    func report(_ error: any Error) {
        if case CommandError.recordingNotFound = error { return }
        if case CommandError.loopLimit = error {
            failure = PracticeText.loopLimit
        } else if case CommandError.noRoom = error {
            failure = PracticeText.noRoom
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

    // MARK: Leaving

    /// The screen is going: a nudge and a name field that lost focus are written, a scrub lands
    /// where it was dragged, and a handle's drag comes to nothing.
    func leave() {
        commitNudge()
        flushBlur()
        if activeScrub != nil { settleScrub(at: scrubbingMs) }
        cancelHandleDrag()
        renaming = nil
        activeKey = nil
        autoPan = 0
    }

    /// The screen's Escape and exit command: closes the name field, else deselects, and only
    /// with neither left runs `close`.
    func escape(orClose close: () -> Void) {
        if !escape() { close() }
    }

    /// Escape: closes the name field, else deselects; false when there was neither, and Escape
    /// then closes the screen.
    func escape() -> Bool {
        if renaming != nil {
            cancelRename()
            return true
        }
        if selectedID != nil {
            select(nil)
            return true
        }
        return false
    }
}
