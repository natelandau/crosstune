import CrosstuneStore
import Foundation

/// Times one recording screen visit while audio plays, and the loops, speeds, and pitches it
/// played with. A visit that played a loop, or played any time away from the default speed or
/// pitch, is practice.
@MainActor
final class PracticeLog {
    /// What a closed visit turned out to be.
    enum Outcome: Equatable {
        /// Practice with enough audio, now written.
        case practice
        /// Not practice, so the caller keeps the visit as an ordinary play.
        case play
    }

    private struct Visit {
        let recordingID: String
        var speedPercent: Int
        var pitchCents: Int
        var span = AudibleSpan()
        var durationMs: Int64 = 0
        var loopIDs: [String] = []
        /// Playing time at each value, in the order each was first played.
        var speedMs: [(value: Int, ms: Int64)] = []
        var pitchMs: [(value: Int, ms: Int64)] = []
    }

    private let clock: @MainActor () -> SuspendingClock.Instant
    private let now: @MainActor () -> Date
    private let write: @MainActor (PracticeSession) -> Void
    private var visit: Visit?

    init(
        clock: @escaping @MainActor () -> SuspendingClock.Instant, now: @escaping @MainActor () -> Date = Date.init,
        write: @escaping @MainActor (PracticeSession) -> Void
    ) {
        self.clock = clock
        self.now = now
        self.write = write
    }

    /// Starts a visit to `recordingID`, not yet playing, at the settings the player holds.
    func open(_ recordingID: String, speedPercent: Int, pitchCents: Int) {
        visit = Visit(recordingID: recordingID, speedPercent: speedPercent, pitchCents: pitchCents)
    }

    func playing(_ isPlaying: Bool) {
        guard visit != nil else { return }
        if isPlaying {
            visit?.span.start(at: clock(), date: now())
        } else {
            book(visit?.span.stop(at: clock()) ?? 0)
        }
    }

    func usedLoop(_ id: String) {
        guard visit?.loopIDs.contains(id) == false else { return }
        visit?.loopIDs.append(id)
    }

    func setSpeed(_ percent: Int) {
        guard let current = visit, current.speedPercent != percent else { return }
        book(visit?.span.take(at: clock()) ?? 0)
        visit?.speedPercent = percent
    }

    func setPitch(_ cents: Int) {
        guard let current = visit, current.pitchCents != cents else { return }
        book(visit?.span.take(at: clock()) ?? 0)
        visit?.pitchCents = cents
    }

    /// Ends the visit. Writes a practice session and returns ``Outcome/practice`` when it was
    /// practice with enough audio; returns nil when it was practice too short to keep, and
    /// ``Outcome/play`` when it was not practice. Nil with no visit open.
    @discardableResult
    func close() -> Outcome? {
        guard visit != nil else { return nil }
        playing(false)
        guard let closed = visit else { return nil }
        visit = nil
        let offDefault =
            closed.speedMs.contains { $0.value != PlaybackSetting.speed.standard }
            || closed.pitchMs.contains { $0.value != PlaybackSetting.pitch.standard }
        if closed.loopIDs.isEmpty && !offDefault { return .play }
        guard let startedAt = closed.span.startedAt, closed.durationMs >= activityThresholdMs else { return nil }
        let createdAt = Timestamp(now())
        write(
            PracticeSession(
                id: newID(at: createdAt), createdAt: createdAt, recordingID: closed.recordingID,
                startedAt: Timestamp(startedAt), durationMs: closed.durationMs,
                speedPercent: Self.longest(closed.speedMs, fallback: closed.speedPercent),
                pitchCents: Self.longest(closed.pitchMs, fallback: closed.pitchCents), loopIDs: closed.loopIDs))
        return .practice
    }

    /// Ends the visit without writing anything.
    func drop() {
        visit = nil
    }

    /// Books `ms` of playing time to the settings in force over it.
    private func book(_ ms: Int64) {
        guard ms > 0, var current = visit else { return }
        current.durationMs += ms
        Self.add(ms, to: current.speedPercent, in: &current.speedMs)
        Self.add(ms, to: current.pitchCents, in: &current.pitchMs)
        visit = current
    }

    private static func add(_ ms: Int64, to value: Int, in times: inout [(value: Int, ms: Int64)]) {
        if let index = times.firstIndex(where: { $0.value == value }) {
            times[index].ms += ms
        } else {
            times.append((value, ms))
        }
    }

    /// The value with the most time; the first to reach it wins a tie.
    private static func longest(_ times: [(value: Int, ms: Int64)], fallback: Int) -> Int {
        var best = (value: fallback, ms: Int64(-1))
        for entry in times where entry.ms > best.ms { best = entry }
        return best.value
    }
}
