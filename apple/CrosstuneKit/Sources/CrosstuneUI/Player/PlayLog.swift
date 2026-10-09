import CrosstuneAnalytics
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

/// The tune a play reports under.
enum ReportedTune: Equatable, Sendable {
    /// The loaded item's row says: its tune, or nil when it is unfiled.
    case known(String?)
    /// Read from the store as the play is reported.
    case lookUp

    /// The tune `item`'s row names, when the item carries its row.
    init(_ item: PlayerItem) {
        switch item.kind {
        case .recording: self = item.recording.map { .known($0.tuneID) } ?? .lookUp
        case .link: self = item.link.map { .known($0.tuneID) } ?? .lookUp
        }
    }
}

/// How a play is reported: where it started, whether a list played it, what started it, what
/// it is, and its tune.
struct PlayAttribution: Equatable, Sendable {
    var source: ActionSource
    var queue: PlaybackQueue
    var trigger: PlaybackTrigger
    var kind: PlaybackKind
    /// A link's service; nil for a recording.
    var service: LinkService?
    var tune: ReportedTune

    init(
        source: ActionSource, queue: PlaybackQueue, trigger: PlaybackTrigger, kind: PlaybackKind,
        service: LinkService?, tune: ReportedTune
    ) {
        self.source = source
        self.queue = queue
        self.trigger = trigger
        self.kind = kind
        self.service = service
        self.tune = tune
    }

    /// `item` played as `queue` asked, from `source`.
    init(_ item: PlayerItem, source: ActionSource, queue: PlaybackQueue, trigger: PlaybackTrigger) {
        self.init(
            source: source, queue: queue, trigger: trigger, kind: PlaybackKind(item),
            service: item.link.map { LinkService(provider: $0.provider) }, tune: ReportedTune(item))
    }
}

extension PlaybackKind {
    /// What `item` is. A recording without its row reads as a take, the commonest kind.
    init(_ item: PlayerItem) {
        switch item.kind {
        case .link: self = .link
        case .recording: self = item.recording.map { PlaybackKind(RecordingOrigin($0)) } ?? .recorded
        }
    }
}

/// A play that closed after sounding, as it is reported.
struct EndedPlay: Equatable, Sendable {
    let subject: PlaySubject
    let origin: PlayOrigin
    let attribution: PlayAttribution
    let listenedMs: Int64
    /// The item's playing length, 0 when it was never known.
    let lengthMs: Int64
    let endedBy: PlaybackEnd
    /// Whether a command from outside the app acted on the play.
    let systemControlled: Bool
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
/// Every play that sounded at all, threshold or not, also goes to ``onEnd``.
@MainActor
final class PlayLog {
    private struct Open {
        let subject: PlaySubject
        let origin: PlayOrigin
        let attribution: PlayAttribution
        var lengthMs: Int64
        var span = AudibleSpan()
        var listenedMs: Int64 = 0
        var systemControlled = false

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
    /// Takes each play that closes having sounded.
    var onEnd: @MainActor (EndedPlay) -> Void = { _ in }

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
    /// How the open play is reported.
    var attribution: PlayAttribution? { open?.attribution }
    /// Whether the open play is being timed as playing.
    var isTiming: Bool { open?.span.isTiming ?? false }

    /// Ends any open play as skipped, then opens one for `subject`, not yet playing.
    func start(_ subject: PlaySubject, origin: PlayOrigin, attribution: PlayAttribution, lengthMs: Int64 = 0) {
        end(.skipped)
        open = Open(subject: subject, origin: origin, attribution: attribution, lengthMs: lengthMs)
    }

    /// Notes that a command from outside the app acted on the open play.
    func markSystemControlled() {
        open?.systemControlled = true
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

    /// Writes the open play if it met the threshold, reports it if it sounded, and closes it.
    func end(_ endedBy: PlaybackEnd) {
        guard open != nil else { return }
        playing(false)
        guard let ended = open else { return }
        open = nil
        if ended.listenedMs > 0 {
            onEnd(
                EndedPlay(
                    subject: ended.subject, origin: ended.origin, attribution: ended.attribution,
                    listenedMs: ended.listenedMs, lengthMs: ended.lengthMs, endedBy: endedBy,
                    systemControlled: ended.systemControlled))
        }
        guard let startedAt = ended.span.startedAt, ended.meetsThreshold else { return }
        let createdAt = Timestamp(now())
        write(
            PlayEvent(
                id: newID(at: createdAt), createdAt: createdAt, context: ended.origin.context.rawValue,
                startedAt: Timestamp(startedAt), listenedMs: ended.listenedMs,
                recordingID: ended.subject.kind == .recording ? ended.subject.id : nil,
                linkID: ended.subject.kind == .link ? ended.subject.id : nil, listID: ended.origin.listID))
    }

    /// Ends the open play, at the item's end unless `endedBy` says otherwise, and opens a fresh
    /// one for the same item, origin, and attribution, not yet playing.
    func flush(_ endedBy: PlaybackEnd = .finished) {
        guard let flushed = open else { return }
        end(endedBy)
        open = Open(
            subject: flushed.subject, origin: flushed.origin, attribution: flushed.attribution,
            lengthMs: flushed.lengthMs)
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
