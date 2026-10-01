import CrosstuneAudio
import CrosstuneStore
import Foundation
import Observation

/// The loaded recording's loops, the selected one, and Repeat, mirrored into the audio player.
/// The player owns it, so the selection outlives Practice for as long as the recording stays
/// loaded, and it follows the loops' rows while Practice is closed too: a span or label changed
/// on another device moves the repeating loop, and a loop removed anywhere turns Repeat off.
///
/// Loop times are on the source timeline and the audio player's in seconds into the playback
/// window, which starts at the trim start, so a new trim or a new file gets the range again.
@MainActor
@Observable
public final class LoopPlayback {
    /// The recording's live loops, by start and then end.
    public private(set) var rows: [RecordingLoop] = []
    public private(set) var selectedID: String?
    public private(set) var isRepeating = false

    @ObservationIgnored private let audio: any AudioPlayback
    /// Where the playback window starts on the source timeline.
    @ObservationIgnored private var trimStartMs: Int64 = 0
    @ObservationIgnored private var isReady = false
    /// A loop just made, selected before the live rows have read it.
    @ObservationIgnored private var unseen: RecordingLoop?
    /// A loop asked for by id before its row is live, as one just put back by undo.
    @ObservationIgnored private var awaited: String?
    /// A span played ahead of its row while its write lands. `base` is the row's span when the
    /// hold was taken: once the row moves off it, a write (this device's or a newer one from
    /// elsewhere) has landed and the row is followed again.
    @ObservationIgnored private var held: (id: String, span: LoopSpan, base: LoopSpan?)?
    /// What the audio player was last told, so a range it already plays is not sent again.
    @ObservationIgnored private var applied: PlaybackWindow??

    init(audio: any AudioPlayback) {
        self.audio = audio
    }

    /// The selected loop's row, or the one just made while the rows catch up.
    public var selected: RecordingLoop? {
        guard let selectedID else { return nil }
        return rows.first { $0.id == selectedID } ?? (unseen?.id == selectedID ? unseen : nil)
    }

    /// The selected loop's name, as "B part" or "Loop 0:58".
    public var selectedName: String? {
        selected.map { LoopModel.name(label: $0.label, startMs: $0.startMs, trimStartMs: trimStartMs) }
    }

    /// Selects loop `id`, or none. A loop taking Repeat over from another starts from its top;
    /// selecting none turns Repeat off.
    public func select(_ id: String?) {
        held = nil
        unseen = nil
        awaited = nil
        guard let id else {
            selectedID = nil
            apply()
            setRepeat(false)
            return
        }
        guard let row = rows.first(where: { $0.id == id }) else {
            awaited = id
            return
        }
        take(row)
    }

    /// Selects `row`, a loop just written that the live rows may not hold yet.
    func select(_ row: RecordingLoop) {
        held = nil
        awaited = nil
        unseen = rows.contains { $0.id == row.id } ? nil : row
        take(row)
    }

    /// Turns Repeat on or off; on only with a loop selected.
    public func setRepeat(_ on: Bool) {
        guard !on || selectedID != nil else { return }
        isRepeating = on
        if isReady { audio.setRepeat(on) }
    }

    public func toggleRepeat() {
        setRepeat(!isRepeating)
    }

    /// Plays `span` for loop `id` ahead of its row until the row lands; nil lets go at once.
    func hold(_ id: String, _ span: LoopSpan?) {
        let base = rows.first { $0.id == id }.map { LoopSpan(startMs: $0.startMs, endMs: $0.endMs) }
        held = span.map { (id, $0, base) }
        apply()
    }

    /// Takes the recording's loops as they now stand.
    func follow(_ loops: [RecordingLoop]) {
        rows =
            loops.filter { $0.deletedAt == nil }
            .sorted { ($0.startMs, $0.endMs, $0.id) < ($1.startMs, $1.endMs, $1.id) }
        if let unseen, rows.contains(where: { $0.id == unseen.id }) { self.unseen = nil }
        if let awaited, let row = rows.first(where: { $0.id == awaited }) {
            self.awaited = nil
            take(row)
        }
        if let selectedID, unseen == nil, !rows.contains(where: { $0.id == selectedID }) {
            held = nil
            self.selectedID = nil
            apply()
            setRepeat(false)
            return
        }
        if let hold = held, let row = rows.first(where: { $0.id == hold.id }) {
            let span = LoopSpan(startMs: row.startMs, endMs: row.endMs)
            if hold.base.map({ $0 != span }) ?? true || span == hold.span { held = nil }
        }
        apply()
    }

    /// The audio player holds a file whose window starts at `trimStartMs`, newly or after a
    /// new trim, so the loop's range is sent again.
    func audioReady(trimStartMs: Int64) {
        self.trimStartMs = trimStartMs
        isReady = true
        // A load always sets the loop aside, so the player holds none until told.
        applied = .some(nil)
        apply()
        // Another recording loading has already turned Repeat off here. The same recording
        // loading again (a new revision, or after a delete that failed) keeps it, unless its
        // file would not play.
        if audio.hasFailed {
            isRepeating = false
        } else if isRepeating != audio.isRepeating {
            audio.setRepeat(isRepeating)
        }
    }

    /// The trim moved while the same file plays.
    func trimMoved(to trimStartMs: Int64) {
        guard trimStartMs != self.trimStartMs else { return }
        self.trimStartMs = trimStartMs
        if case .some(.some) = applied { applied = nil }
        apply()
    }

    /// The audio is gone for now, as while a delete is under way.
    func audioGone() {
        isReady = false
        applied = nil
    }

    /// The recording is loading again, another is, or none is: nothing is selected and nothing
    /// repeats. The rows stay for a reload of the same recording, whose rows are not read again.
    func reset(forgettingRows: Bool) {
        if forgettingRows { rows = [] }
        selectedID = nil
        isRepeating = false
        unseen = nil
        awaited = nil
        held = nil
        isReady = false
        applied = nil
    }

    private func take(_ row: RecordingLoop) {
        let fromAnother = selectedID != row.id
        selectedID = row.id
        apply()
        if isRepeating && fromAnother && isReady {
            audio.seek(to: Double(row.startMs - trimStartMs) / 1000)
        }
    }

    /// Sends the selected loop's range to the audio player when it differs from what it holds.
    private func apply() {
        guard isReady else { return }
        let range = selected.map { row -> PlaybackWindow in
            var span = LoopSpan(startMs: row.startMs, endMs: row.endMs)
            if let held, held.id == row.id { span = held.span }
            return PlaybackWindow(
                from: Double(span.startMs - trimStartMs) / 1000, to: Double(span.endMs - trimStartMs) / 1000)
        }
        if let applied, applied == range { return }
        applied = .some(range)
        audio.setLoop(range)
    }
}
