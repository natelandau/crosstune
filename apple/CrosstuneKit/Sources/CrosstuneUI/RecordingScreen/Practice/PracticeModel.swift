import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
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

/// A recording's practice: the waveform under a fixed playhead, its zoom and scrubbing, the
/// loops drawn on it, and naming them. While the player holds the recording, the playhead,
/// speed, pitch, and isolate are the player's, and the selection, which is what repeats, belongs
/// to the player's ``LoopPlayback``, so it outlives this screen. While it holds another, the
/// model keeps its own playhead and selection on the row's timeline, writes speed, pitch, and
/// isolate to the row, and Play loads the recording there. Every loop write is one per finished
/// action, made when the gesture or key ends; none can be undone.
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

    /// A move of the selected loop by its handles, from a drag or a run of key steps, until it
    /// is committed.
    struct HandleDrag {
        /// The edge a move holds.
        enum Part {
            case start, end

            /// The edge a move from `shown` to `proposed` holds; nil unless exactly one edge moved.
            init?(from shown: LoopSpan, to proposed: LoopSpan) {
                switch (proposed.startMs != shown.startMs, proposed.endMs != shown.endMs) {
                case (true, false): self = .start
                case (false, true): self = .end
                default: return nil
                }
            }
        }

        let id: String
        let part: Part
        /// The move is a run of arrow-key steps, which leaving the screen writes rather than drops.
        var isKeySteps = false
        /// The loop's span when the move began.
        let origin: LoopSpan
        /// The free span around the loop, which the move never leaves.
        let room: LoopSpan
        /// A pinch took the move over: the loop went back unwritten and moves no more.
        var isCancelled = false

        /// The span the move makes with the handles at `proposed`, held to the room.
        func placed(_ proposed: LoopSpan) -> LoopSpan {
            switch part {
            case .start: return LoopModel.resize(origin, edge: .start, to: proposed.startMs, bounds: room)
            case .end: return LoopModel.resize(origin, edge: .end, to: proposed.endMs, bounds: room)
            }
        }
    }

    /// A released drag coasting from `from` to `to` over `runMs` from `start`. Its position is
    /// read from the clock as each frame draws, rather than stored step by step.
    struct MomentumScroll: Equatable {
        let from: Int64
        let to: Int64
        let start: ContinuousClock.Instant
        let runMs: Double

        func position(at now: ContinuousClock.Instant) -> Int64 {
            let parts = (now - start).components
            let elapsed = Double(parts.seconds) * 1000 + Double(parts.attoseconds) / 1e15
            return PracticeZoom.momentumScrollPosition(from: from, to: to, elapsedMs: elapsed, runMs: runMs)
        }
    }

    /// A drag on the waveform past the threshold, which holds playback until it settles.
    struct Scrub {
        var originMs: Int64
        var pinch: Int
        let wasPlaying: Bool
    }

    static let arrowStepMs: Int64 = 1000
    static let arrowLargeStepMs: Int64 = 5000

    let player: PlayerModel
    private(set) var recording: Recording
    private(set) var file: RecordingFile?
    /// The recording's tune's part structure, for name suggestions.
    var partStructure: String?
    /// The recording's tune's title, which the recording plays under once Play loads it.
    var tuneTitle: String?
    /// The loops' rows while the player holds another recording, by start and then end.
    private(set) var ownLoops: [RecordingLoop] = []
    /// The selected loop while the player holds another recording.
    private(set) var ownSelectedID: String?
    /// A loop just made and selected before the rows hold it.
    private(set) var ownUnseen: RecordingLoop?
    /// The playhead on the trimmed timeline while the player holds another recording.
    var ownPositionMs: Int64 = 0
    /// Speed, pitch, and isolate changed here while the player holds another recording, each
    /// ahead of the row until the row holds it.
    var ownEdits = PlaybackSettings()
    /// The mode whose controls show under the waveform, which the mode panel reads and sets;
    /// a page opens on Speed. Leaving a mode closes its panel.
    var mode: PracticeMode {
        didSet {
            guard mode != oldValue, isPanelShown, areModeControlsShown else { return }
            closePanel(oldValue)
            openPanel()
        }
    }
    /// The mode whose popover shows where the controls open in one, which the mode panel reads
    /// and sets, so the screen's Escape can close the popover rather than the screen.
    var openTool: PracticeMode?
    private(set) var drafts: [String: Draft] = [:]
    /// The draft a gesture or a held key is still drawing, which waits for it to end.
    var activeKey: String?
    /// The loop whose name field is open.
    private(set) var renaming: String?
    /// Why the last loop write did not land.
    var failure: String?
    /// The loop New loop just made, whose handles open from the playhead.
    var insertedID: String?

    /// The view's width in points; 0 until measured.
    var width: Double = 0
    /// The zoom, held as set; ``scale`` keeps it within what the view's width allows.
    var pointsPerSecond: Double?
    /// The playhead while a drag holds it, on the trimmed timeline.
    var draggedMs: Int64?
    /// The momentum scroll under way, if any, which the waveform's frames follow.
    var momentumScroll: MomentumScroll?
    /// The playhead while a drag or its momentum scroll moves it, on the trimmed timeline; playback seeks
    /// there once it settles.
    var scrubbingMs: Int64? {
        get { momentumScroll.map { $0.position(at: clock()) } ?? draggedMs }
        set { draggedMs = newValue }
    }

    @ObservationIgnored let writer: LoopWriter
    @ObservationIgnored let clock: () -> ContinuousClock.Instant
    @ObservationIgnored let announce: (String) -> Void
    /// The recording page this practice is on, which owns the playback its Play starts.
    @ObservationIgnored let page: UUID?
    @ObservationIgnored var handleDrag: HandleDrag?
    @ObservationIgnored var activeScrub: Scrub?
    /// Changes to ``ownEdits`` waiting out the player's settle delay before they are written.
    @ObservationIgnored var ownSettling: [PlaybackSetting: Task<Void, Never>] = [:]
    /// Settles the momentum scroll under way once its run ends.
    @ObservationIgnored var momentumTask: Task<Void, Never>?
    /// How long a released drag coasts: three time constants, where 95% of its distance is covered.
    @ObservationIgnored var momentumScrollRun: Duration = .milliseconds(3 * PracticeZoom.momentumScrollTauMs)
    @ObservationIgnored var pinches = 0
    @ObservationIgnored var pinchBase: Double?
    /// The player's last reported position and when it came, which the playhead runs on from
    /// between the player's reports.
    @ObservationIgnored var reading: (elapsed: TimeInterval, at: ContinuousClock.Instant)?
    /// A name field's text waiting to be written after the field lost focus.
    @ObservationIgnored private var blurred: Task<Void, Never>?
    @ObservationIgnored private var blurredText: String?
    /// How long a name field that lost focus waits before it writes, so a suggestion chip
    /// whose press took the focus away writes its own name instead.
    @ObservationIgnored var blurDelay: Duration = .milliseconds(300)
    /// Waits out ``blurDelay`` and ``momentumScrollRun``.
    @ObservationIgnored var sleep: @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    @ObservationIgnored private var renameOpened = ""
    /// What the open name field holds, so a touch elsewhere can save it without waiting on focus.
    @ObservationIgnored private var renameDraft: String?
    @ObservationIgnored private var writes: [UUID: Task<Void, Never>] = [:]
    /// The settings the open panel showed as it opened, which it is reported against as
    /// it closes, so a slider dragged through many values reports only where it stopped.
    @ObservationIgnored private var panelOpenedOn: PlayedSettings?
    /// Whether the practice view shows, so its panel reports and holds the outline.
    @ObservationIgnored private var isPanelShown = false
    /// Whether the mode's controls show: always under tabs, and only while its popover is
    /// open where the controls open in one.
    @ObservationIgnored private var areModeControlsShown: Bool
    /// This screen's hold on the isolate outline while its Isolate panel shows.
    @ObservationIgnored private let panelRequester = UUID()

    init(
        player: PlayerModel, recording: Recording, file: RecordingFile?, writer: LoopWriter,
        mode: PracticeMode = .speed, page: UUID? = nil, modeControlsShown: Bool = true,
        clock: @escaping () -> ContinuousClock.Instant = { .now },
        announce: @escaping (String) -> Void = { AccessibilityNotification.Announcement($0).post() }
    ) {
        self.player = player
        self.recording = recording
        self.file = file
        self.writer = writer
        self.mode = mode
        self.page = page
        areModeControlsShown = modeControlsShown
        self.clock = clock
        self.announce = announce
    }

    /// A screen that goes without leaving still lets go of the isolate outline.
    isolated deinit {
        player.requestIsolateOutline(false, by: panelRequester)
    }

    // MARK: The recording

    var trimStartMs: Int64 { recording.trimStartMs }

    /// Whether the player holds this recording, whose playback state is then the player's.
    var isCurrent: Bool { player.holds(.recording, id: recording.id) }

    /// Whether the waveform can be used: the loaded recording's audio is ready, or the player
    /// holds another recording and the waveform works from the row.
    var isLoaded: Bool { isCurrent ? player.isRecordingAudioReady : true }

    /// Whether the recording is playing, which only the loaded one can be.
    var isPlaying: Bool { isCurrent && player.audio.isPlaying }

    /// The trimmed recording's length: the player's once its audio is loaded, else the row's,
    /// and 0 while nothing says how long it is.
    var lengthMs: Int64 {
        if isCurrent, player.isRecordingAudioReady, let duration = player.audio.duration {
            return Int64((duration * 1000).rounded())
        }
        return ScreenRows.trimmedLengthMs(recording, file: file) ?? 0
    }

    /// The trim range on the source timeline, which no loop leaves.
    var bounds: LoopSpan { LoopSpan(startMs: trimStartMs, endMs: trimStartMs + lengthMs) }

    /// The playhead on the trimmed timeline.
    var positionMs: Double {
        guard isCurrent else { return Double(ownPositionMs) }
        return player.isRecordingAudioReady ? player.audio.elapsed * 1000 : 0
    }

    /// The playhead on the source timeline where it shows, a scrub or momentum scroll under way
    /// included, which is where every loop command acts.
    var playheadMs: Int64 { trimStartMs + centerMs }

    /// Takes the recording's row and file as they are now.
    func follow(_ recording: Recording, file: RecordingFile?) {
        if recording != self.recording {
            self.recording = recording
            followOwnEdits(recording)
        }
        if file != self.file { self.file = file }
        ensureZoom()
    }

    /// Takes the recording's loops as they are now, which the model keeps for itself while the
    /// player holds another recording.
    func followLoops(_ rows: [RecordingLoop]) {
        let live =
            rows.filter { $0.deletedAt == nil }
            .sorted { ($0.startMs, $0.endMs, $0.id) < ($1.startMs, $1.endMs, $1.id) }
        if live != ownLoops { ownLoops = live }
        if let unseen = ownUnseen, live.contains(where: { $0.id == unseen.id }) { ownUnseen = nil }
        if let id = ownSelectedID, ownUnseen?.id != id, !live.contains(where: { $0.id == id }) { ownSelectedID = nil }
    }

    // MARK: Loops and selection

    var loops: [RecordingLoop] { isCurrent ? player.loops.rows : ownLoops }
    var selectedID: String? { isCurrent ? player.loops.selectedID : ownSelectedID }
    var selected: RecordingLoop? {
        guard !isCurrent else { return player.loops.selected }
        guard let ownSelectedID else { return nil }
        return ownLoops.first { $0.id == ownSelectedID } ?? (ownUnseen?.id == ownSelectedID ? ownUnseen : nil)
    }
    var isRepeating: Bool { isCurrent ? player.loops.isRepeating : ownSelectedID != nil }

    func name(_ loop: RecordingLoop) -> String {
        LoopModel.name(label: loop.label, startMs: loop.startMs, trimStartMs: trimStartMs)
    }

    /// Selects loop `id`, which then repeats, or none, which plays on.
    func select(_ id: String?) {
        if id != insertedID { insertedID = nil }
        guard !isCurrent else {
            player.loops.select(id)
            return
        }
        ownUnseen = nil
        ownSelectedID = id
        bringPlayheadIntoSelected()
    }

    /// Selects `row`, a loop just written that the rows may not hold yet.
    func select(_ row: RecordingLoop) {
        guard !isCurrent else {
            player.loops.select(row)
            return
        }
        ownUnseen = ownLoops.contains { $0.id == row.id } ? nil : row
        ownSelectedID = row.id
        bringPlayheadIntoSelected()
    }

    /// Plays `span` for loop `id` ahead of its row while the player holds this recording.
    func hold(_ id: String, _ span: LoopSpan?) {
        if isCurrent { player.loops.hold(id, span) }
    }

    /// A playhead outside the selected loop moves to its start, as the player's selection does.
    private func bringPlayheadIntoSelected() {
        guard let row = selected else { return }
        let start = row.startMs - trimStartMs
        let end = row.endMs - trimStartMs
        if ownPositionMs < start || ownPositionMs >= end { ownPositionMs = max(0, start) }
    }

    /// Loop `id`'s row, the selected loop's included while the live rows catch up with it.
    func row(_ id: String) -> RecordingLoop? {
        loops.first { $0.id == id } ?? (selected?.id == id ? selected : nil)
    }

    /// Every loop's row by id, the selected loop's included while the live rows catch up with it.
    var rowsByID: [String: RecordingLoop] {
        var rows = Dictionary(loops.map { ($0.id, $0) }) { first, _ in first }
        if let selected, rows[selected.id] == nil { rows[selected.id] = selected }
        return rows
    }

    /// The span a loop shows: its draft until the row has caught up, else its row.
    func shownSpan(_ id: String) -> LoopSpan? {
        guard let row = row(id) else { return drafts[id]?.span }
        return shownSpan(of: row)
    }

    /// The span `row`'s loop shows: its draft until the row has caught up, else the row's own.
    func shownSpan(of row: RecordingLoop) -> LoopSpan {
        let span = Self.span(row)
        guard let draft = drafts[row.id] else { return span }
        return hasLanded(row.id, span, draft) ? span : draft.span
    }

    /// Whether loop `id`'s row has caught up with `draft`.
    private func hasLanded(_ id: String, _ draft: Draft) -> Bool {
        guard let row = row(id) else { return false }
        return hasLanded(id, Self.span(row), draft)
    }

    /// Whether loop `id`'s row, now at `row`, has caught up with `draft`: it holds the drafted
    /// span, or it has moved off `base` (a write, this device's or a newer one, has landed) and
    /// no gesture is still drawing it.
    private func hasLanded(_ id: String, _ row: LoopSpan, _ draft: Draft) -> Bool {
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
        let sleep = sleep
        blurred = Task { [weak self] in
            try? await sleep(delay)
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
        if id == selectedID { hold(id, span) }
        run { [self] in
            do {
                try await writer.update(id, span, .keep)
            } catch {
                dropDraft(id)
                if id == selectedID { hold(id, nil) }
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
    /// it is now for its base.
    func putDraft(_ key: String, _ span: LoopSpan) {
        for (id, draft) in drafts where hasLanded(id, draft) { drafts[id] = nil }
        let base = drafts[key]?.base ?? loops.first { $0.id == key }.map(Self.span)
        drafts[key] = Draft(span: span, base: base, sent: drafts[key]?.sent ?? [])
    }

    func dropDraft(_ key: String) {
        drafts[key] = nil
    }

    // MARK: Arriving and leaving

    /// The practice view is showing: the open mode's panel starts reporting its changes. The
    /// page, not the practice view, owns the visit, so a tab switch never ends it.
    func showPanel() {
        guard !isPanelShown else { return }
        isPanelShown = true
        if areModeControlsShown { openPanel() }
    }

    /// The mode's popover opened or closed. Closing reports the mode's setting and lets the
    /// isolate outline go, as leaving the mode does; opening starts the panel again.
    func modeControlsShown(_ shown: Bool) {
        guard shown != areModeControlsShown else { return }
        if isPanelShown, !shown { closePanel(mode) }
        areModeControlsShown = shown
        if isPanelShown, shown { openPanel() }
    }

    /// The player has taken this recording or let it go: the Isolate panel holds the isolate
    /// outline only while the player holds the recording it shows.
    func currentChanged() {
        guard isPanelShown, areModeControlsShown, mode == .isolate else { return }
        player.requestIsolateOutline(isCurrent, by: panelRequester)
    }

    /// Opens the visit to the recording, once the player holds it: a page open on a recording
    /// that is not loaded is no visit, since nothing of it plays.
    func openVisit(screen: UUID? = nil) {
        guard isCurrent else { return }
        player.screenOpened(recording.id, recording: recording, by: screen)
    }

    /// The screen is going: a name field that lost focus is written, a scrub lands where it
    /// was dragged, a run of key steps on a handle is written, and a handle's drag comes to
    /// nothing.
    func leave() {
        flushOwnSettings()
        isPanelShown = false
        if areModeControlsShown { closePanel(mode) }
        flushBlur()
        if activeScrub != nil { settleScrub(at: scrubbingMs) }
        commitHandleKeySteps()
        cancelHandleDrag()
        handleDrag = nil
        renaming = nil
        activeKey = nil
    }

    /// The Isolate panel engages the isolate unit while it shows, so its outline is live and the
    /// first change brings no jump in delay.
    private func openPanel() {
        panelOpenedOn = playedSettings
        // A recording the player does not hold has no outline, and asking would engage the
        // isolate unit for the one that plays.
        if mode == .isolate, isCurrent { player.requestIsolateOutline(true, by: panelRequester) }
    }

    /// Reports the panel's setting where it differs from the one it opened on, both read for
    /// this screen's recording even after the player has moved on to another; unknown, nothing
    /// is reported. Isolate sends only the effect and which ranges are narrowed, never the ranges.
    private func closePanel(_ mode: PracticeMode) {
        if mode == .isolate { player.requestIsolateOutline(false, by: panelRequester) }
        defer { panelOpenedOn = nil }
        guard let opened = panelOpenedOn, let now = playedSettings else { return }
        switch mode {
        case .loops: break
        case .speed:
            if now.speedPercent != opened.speedPercent {
                player.analytics.send(.speedChanged(rate: Double(now.speedPercent) / 100, recordingID: recording.id))
            }
        case .pitch:
            // Reported in whole semitones, so a few cents either way is no change.
            let semitones = PitchSplit(cents: now.pitchCents).semitones
            if semitones != PitchSplit(cents: opened.pitchCents).semitones {
                player.analytics.send(.pitchChanged(semitones: semitones, recordingID: recording.id))
            }
        case .isolate:
            guard now.isolate != opened.isolate else { return }
            let isMono = (isCurrent ? player.isMono : nil) ?? recording.isMono
            let setting = now.isolate.effective(isMono: isMono == true)
            let full = IsolateSetting.standard
            player.analytics.send(
                .isolateChanged(
                    effect: setting.effect,
                    usesStereo: setting.panStart != full.panStart || setting.panEnd != full.panEnd,
                    usesFrequency: setting.lowHz != full.lowHz || setting.highHz != full.highHz,
                    recordingID: recording.id))
        }
    }

    /// The screen's Escape and exit command: closes the name field, else the open tool's
    /// popover, else deselects, and only with none of them left runs `close`.
    func escape(orClose close: () -> Void) {
        if !escape() { close() }
    }

    /// Escape: closes the name field, else the open tool's popover, else deselects; false when
    /// there was none of them, and Escape then closes the screen.
    func escape() -> Bool {
        if renaming != nil {
            cancelRename()
            return true
        }
        if openTool != nil {
            openTool = nil
            return true
        }
        if selectedID != nil {
            select(nil)
            return true
        }
        return false
    }
}
