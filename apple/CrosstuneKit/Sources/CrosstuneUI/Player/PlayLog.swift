import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// Audible time a play needs, unless the item itself is shorter, and the audio a practice
/// session needs.
let activityThresholdMs: Int64 = 10_000

/// How long `lengthMs` of audio takes to hear at `speedPercent`, so "the whole item" means the
/// whole item at any speed.
func heardLengthMs(_ lengthMs: Int64, speedPercent: Int) -> Int64 {
    guard speedPercent > 0 else { return lengthMs }
    return Int64((Double(lengthMs) * 100 / Double(speedPercent)).rounded())
}

/// Where a play was asked for, as the API's play context names it.
public enum PlayOrigin: Hashable, Sendable {
    /// A recording's or a link's own row.
    case row
    /// A list's row or the list playing as a playlist.
    case list(id: String)
    /// The player bar, or anything that loads without naming where.
    case dock
    /// The recording screen, while it is open.
    case recordingScreen

    var context: Vocabulary.PlayContext {
        switch self {
        case .row: .row
        case .list: .list
        case .dock: .dock
        case .recordingScreen: .recordingScreen
        }
    }

    var listID: String? {
        guard case .list(let id) = self else { return nil }
        return id
    }
}

/// What a play is of: one of the musician's recordings or a link.
struct PlaySubject: Hashable, Sendable {
    let kind: PlayerItem.Kind
    let id: String
}

/// Time while something plays, measured on a clock the caller reads that stops while the device
/// sleeps.
struct AudibleSpan {
    /// When it first started playing, or nil if it never has.
    private(set) var startedAt: Date?
    private var since: SuspendingClock.Instant?

    var isTiming: Bool { since != nil }

    /// Starts timing at `instant`, which is `date` on the wall clock; does nothing while timing.
    mutating func start(at instant: SuspendingClock.Instant, date: Date) {
        guard since == nil else { return }
        since = instant
        if startedAt == nil { startedAt = date }
    }

    /// The milliseconds since the last start or take, timing on from `instant`; 0 while stopped.
    mutating func take(at instant: SuspendingClock.Instant) -> Int64 {
        guard let since else { return 0 }
        self.since = instant
        return since.duration(to: instant).milliseconds
    }

    /// The milliseconds since the last start or take, and stops timing.
    mutating func stop(at instant: SuspendingClock.Instant) -> Int64 {
        let ms = take(at: instant)
        since = nil
        return ms
    }
}

/// Times one item at a time by wall-clock time while it plays, at any speed, and writes it as a
/// play when it ends having met the threshold: 10 seconds, or the whole item when it is shorter.
@MainActor
final class PlayLog {
    private struct Open {
        let subject: PlaySubject
        let origin: PlayOrigin
        var lengthMs: Int64
        var span = AudibleSpan()
        var listenedMs: Int64 = 0

        /// An unknown length (0) needs the full threshold.
        var meetsThreshold: Bool {
            let needed = lengthMs > 0 ? min(activityThresholdMs, lengthMs) : activityThresholdMs
            return listenedMs > 0 && listenedMs >= needed
        }
    }

    private let clock: @MainActor () -> SuspendingClock.Instant
    private let now: @MainActor () -> Date
    private let write: @MainActor (PlayEvent) -> Void
    private var open: Open?

    /// - Parameters:
    ///   - clock: Measures audible time.
    ///   - now: The wall clock a play's start and creation are stamped with.
    ///   - write: Takes each play that met the threshold.
    init(
        clock: @escaping @MainActor () -> SuspendingClock.Instant, now: @escaping @MainActor () -> Date = Date.init,
        write: @escaping @MainActor (PlayEvent) -> Void
    ) {
        self.clock = clock
        self.now = now
        self.write = write
    }

    /// What the open play is of.
    var current: PlaySubject? { open?.subject }
    /// Where the open play was asked for.
    var origin: PlayOrigin? { open?.origin }
    /// Whether the open play is being timed as playing.
    var isTiming: Bool { open?.span.isTiming ?? false }

    /// Ends any open play, then opens one for `subject`, not yet playing.
    func start(_ subject: PlaySubject, origin: PlayOrigin, lengthMs: Int64 = 0) {
        end()
        open = Open(subject: subject, origin: origin, lengthMs: lengthMs)
    }

    /// The item's playing length as heard at the current speed, once the player knows it.
    func setLength(_ lengthMs: Int64) {
        open?.lengthMs = lengthMs
    }

    func playing(_ isPlaying: Bool) {
        guard open != nil else { return }
        if isPlaying {
            open?.span.start(at: clock(), date: now())
        } else {
            let ms = open?.span.stop(at: clock()) ?? 0
            open?.listenedMs += ms
        }
    }

    /// Writes the open play if it met the threshold, and closes it.
    func end() {
        guard open != nil else { return }
        playing(false)
        guard let ended = open else { return }
        open = nil
        guard let startedAt = ended.span.startedAt, ended.meetsThreshold else { return }
        let createdAt = Timestamp(now())
        write(
            PlayEvent(
                id: newID(at: createdAt), createdAt: createdAt, context: ended.origin.context.rawValue,
                startedAt: Timestamp(startedAt), listenedMs: ended.listenedMs,
                recordingID: ended.subject.kind == .recording ? ended.subject.id : nil,
                linkID: ended.subject.kind == .link ? ended.subject.id : nil, listID: ended.origin.listID))
    }

    /// Ends the open play and opens a fresh one for the same item and origin, not yet playing.
    func flush() {
        guard let flushed = open else { return }
        start(flushed.subject, origin: flushed.origin, lengthMs: flushed.lengthMs)
    }

    /// Closes the open play without writing it.
    func drop() {
        open = nil
    }
}

extension Duration {
    /// Whole milliseconds, rounded toward zero.
    var milliseconds: Int64 {
        let (seconds, attoseconds) = components
        return seconds * 1000 + attoseconds / 1_000_000_000_000_000
    }
}
