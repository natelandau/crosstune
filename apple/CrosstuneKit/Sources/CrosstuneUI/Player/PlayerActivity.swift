import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import Foundation
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "activity")

/// Where the player writes each play and practice session. `owner` names the store the writes
/// land in, so a writer for another store is told apart from the same store's set again.
/// `findTune` reads the tune a recording or link belongs to, for what the player reports.
public struct ActivityWriter {
    let owner: AnyHashable
    let play: @MainActor (PlayEvent) -> Void
    let practice: @MainActor (PracticeSession) -> Void
    let findTune: @MainActor (_ recordingID: String?, _ linkID: String?) async -> String?

    public init(
        owner: AnyHashable, play: @escaping @MainActor (PlayEvent) -> Void,
        practice: @escaping @MainActor (PracticeSession) -> Void,
        findTune: @escaping @MainActor (_ recordingID: String?, _ linkID: String?) async -> String? = { _, _ in nil }
    ) {
        self.owner = owner
        self.play = play
        self.practice = practice
        self.findTune = findTune
    }

    /// Records into `store`, under the tune the recording or link belongs to when written. A
    /// write that fails is logged and dropped: a lost play is not worth interrupting the
    /// musician over. A write landing after sign-out closed the store is dropped quietly.
    public static func store(_ store: CrosstuneStore) -> ActivityWriter {
        let commands = Commands(store: store)
        return ActivityWriter(
            owner: ObjectIdentifier(store),
            play: { event in
                Task {
                    guard !store.isClosed else { return }
                    var event = event
                    event.tuneID = await tuneID(in: store, recordingID: event.recordingID, linkID: event.linkID)
                    do {
                        try await commands.recordEvent(event)
                    } catch {
                        if !store.isClosed { logger.error("A play was not recorded: \(error, privacy: .public)") }
                    }
                }
            },
            practice: { session in
                Task {
                    guard !store.isClosed else { return }
                    var session = session
                    session.tuneID = await tuneID(in: store, recordingID: session.recordingID, linkID: nil)
                    do {
                        try await commands.recordEvent(session)
                    } catch {
                        if !store.isClosed {
                            logger.error("A practice session was not recorded: \(error, privacy: .public)")
                        }
                    }
                }
            },
            findTune: { recordingID, linkID in
                guard !store.isClosed else { return nil }
                return await tuneID(in: store, recordingID: recordingID, linkID: linkID)
            })
    }

    private static func tuneID(in store: CrosstuneStore, recordingID: String?, linkID: String?) async -> String? {
        do {
            return try await store.read { db -> String? in
                if let recordingID { return try Recording.fetchOne(db, key: recordingID)?.tuneID }
                if let linkID { return try RecordingLink.fetchOne(db, key: linkID)?.tuneID }
                return nil
            }
        } catch {
            if !store.isClosed { logger.error("A logged item's tune was not read: \(error, privacy: .public)") }
            return nil
        }
    }
}

/// What the player's activity follows: whether the loaded item plays, its length, and, for the
/// recording screen, the settings and loop it plays with.
struct ActivitySnapshot: Equatable, Sendable {
    /// The loaded item, which the other fields describe.
    var loaded: PlaySubject?
    var playing = false
    /// The loaded item's playing length, 0 while unknown.
    var lengthMs: Int64 = 0
    var speedPercent = PlaybackSetting.speed.standard
    var pitchCents = PlaybackSetting.pitch.standard
    /// Whether the trim screen holds the recording at normal speed and pitch.
    var trimming = false
    /// The loop repeating, if any.
    var loopID: String?
    /// Whether the position is within a second of the end, where a player that never reports
    /// its end stops on its own.
    var atEnd = false
}

/// Logs what the player plays: each item as a play, and each recording screen visit as a
/// practice session or, when it was not practice, as a play in the screen's context. Each is
/// also reported as it ends, without waiting on its write.
///
/// Opening the screen ends the play under way; the visit is one unit whatever it plays, and
/// playing on after it closes is a fresh play. Reaching the end of an item ends its play, so a
/// replay is another. A play belongs to the store open while it played: a writer for another
/// store drops it, unreported.
@MainActor
final class PlayerActivity {
    /// Holds the writer, which can change after the logs are made.
    private final class Sink {
        var writer: ActivityWriter?
    }

    let plays: PlayLog
    private let practice: PracticeLog
    private let sink: Sink
    private let analytics: AnalyticsClient
    /// The recording whose screen is open, which owns the play log until it closes.
    private(set) var screenRecordingID: String?
    /// What the open screen's recording is, its tune, and where the screen was asked for.
    private var screenKind = PlaybackKind.recorded
    private var screenTune = ReportedTune.lookUp
    private var screenSource = ActionSource.dock
    /// Set as the app quits, when a report cannot wait on the store for its tune.
    private var quitting = false
    #if DEBUG
        /// The last state fed in, which a test waits on.
        private(set) var lastFed: ActivitySnapshot?
    #endif

    init(
        clock: @escaping @MainActor () -> SuspendingClock.Instant, now: @escaping @MainActor () -> Date,
        analytics: AnalyticsClient = .noop
    ) {
        let sink = Sink()
        self.sink = sink
        self.analytics = analytics
        plays = PlayLog(clock: clock, now: now) { sink.writer?.play($0) }
        practice = PracticeLog(clock: clock, now: now) { sink.writer?.practice($0) }
        plays.onEnd = { [weak self] in self?.report($0) }
        practice.onEnd = { [weak self] in self?.report($0) }
    }

    /// Takes `writer`. One for another store drops what is open, which belongs to the store
    /// that was open while it played.
    func setWriter(_ writer: ActivityWriter?) {
        if writer?.owner != sink.writer?.owner { drop() }
        sink.writer = writer
    }

    /// `subject` was loaded from `origin`, reported as `attribution`. Skips the play under way
    /// unless `keepsSame` and it is of `subject`, or the open screen owns `subject` already.
    func begin(_ subject: PlaySubject, origin: PlayOrigin, attribution: PlayAttribution, keepsSame: Bool) {
        if let screen = screenRecordingID {
            if subject == PlaySubject(kind: .recording, id: screen) { return }
            closeScreen(.skipped, resuming: nil, with: nil)
        }
        if keepsSame && plays.current == subject { return }
        plays.start(subject, origin: origin, attribution: attribution)
    }

    /// The loaded item is gone.
    func itemGone() {
        closeScreen(.closed, resuming: nil, with: nil)
        plays.end(.closed)
    }

    /// The app is quitting: the open visit and play end as closed and are reported at once, a
    /// tune the loaded item does not name left out, so the flush that follows sends them.
    func appQuitting() {
        quitting = true
        defer { quitting = false }
        itemGone()
    }

    /// A command from outside the app is about to act on the open play.
    func systemCommand() {
        plays.markSystemControlled()
    }

    func feed(_ snapshot: ActivitySnapshot) {
        #if DEBUG
            lastFed = snapshot
        #endif
        if snapshot.lengthMs > 0 {
            plays.setLength(heardLengthMs(snapshot.lengthMs, speedPercent: snapshot.speedPercent))
        }
        // MusicKit reports no end for a song played on its own, so stopping at the end stands in
        // for one: a replay is then a play of its own.
        if plays.isTiming, !snapshot.playing, snapshot.atEnd, screenRecordingID == nil {
            plays.flush(.finished)
            return
        }
        guard let screen = screenRecordingID else {
            plays.playing(snapshot.playing)
            return
        }
        // Until the screen's recording is loaded, the player plays another, whose audio and
        // settings are not the visit's.
        let screenLoaded = snapshot.loaded == PlaySubject(kind: .recording, id: screen)
        if screenLoaded {
            practice.setSpeed(snapshot.speedPercent)
            practice.setPitch(snapshot.pitchCents)
        }
        // The trim screen forces normal speed and pitch so what is heard is what is cut. That
        // is neither practice nor a listen, so its time counts toward nothing.
        let audible = screenLoaded && snapshot.playing && !snapshot.trimming
        plays.playing(audible)
        practice.playing(audible)
        if audible, let loopID = snapshot.loopID { practice.usedLoop(loopID) }
    }

    func trackEnded(_ end: TrackEnd) {
        guard end == .finished, screenRecordingID == nil else { return }
        plays.flush(.finished)
    }

    /// The screen, asked for from `source`, now shows `recordingID`, which is a `kind` under
    /// `tune`: the play under way ends as closed, and the visit begins.
    func screenOpened(
        _ recordingID: String, kind: PlaybackKind, tune: ReportedTune, source: ActionSource, loaded: PlaySubject?,
        with snapshot: ActivitySnapshot
    ) {
        guard screenRecordingID != recordingID else { return }
        closeScreen(.closed, resuming: nil, with: nil)
        plays.end(.closed)
        screenRecordingID = recordingID
        screenKind = kind
        screenTune = tune
        screenSource = source
        let subject = PlaySubject(kind: .recording, id: recordingID)
        plays.start(subject, origin: .recordingScreen, attribution: screenAttribution)
        practice.open(recordingID, speedPercent: snapshot.speedPercent, pitchCents: snapshot.pitchCents)
        if loaded == subject { feed(snapshot) }
    }

    /// The screen has let go: its visit is written as practice or as a play, and the recording
    /// still loaded plays on in a fresh play.
    func screenClosed(loaded: PlaySubject?, with snapshot: ActivitySnapshot) {
        closeScreen(.closed, resuming: loaded, with: snapshot)
    }

    /// Audio playing on in the background is still one listen or one visit, so nothing is
    /// written. Otherwise an open visit is written, since the app may never come back, and the
    /// screen still open starts another; an open play is written and starts afresh.
    func leftForeground(loaded: PlaySubject?, with snapshot: ActivitySnapshot) {
        guard !snapshot.playing else { return }
        if let screen = screenRecordingID {
            closeScreen(.paused, resuming: loaded, with: snapshot)
            screenOpened(
                screen, kind: screenKind, tune: screenTune, source: screenSource, loaded: loaded, with: snapshot)
            return
        }
        guard plays.current != nil else { return }
        plays.flush(.paused)
    }

    /// Forgets the open play and visit without writing or reporting either.
    func drop() {
        plays.drop()
        practice.drop()
        screenRecordingID = nil
    }

    /// Ends the open visit, a play reported as `endedBy` when it was not practice.
    private func closeScreen(_ endedBy: PlaybackEnd, resuming loaded: PlaySubject?, with snapshot: ActivitySnapshot?) {
        guard let screen = screenRecordingID else { return }
        screenRecordingID = nil
        if practice.close() == .play {
            plays.end(endedBy)
        } else {
            plays.drop()
        }
        let subject = PlaySubject(kind: .recording, id: screen)
        guard let snapshot, loaded == subject else { return }
        // Playing on is still the play the screen started, so it keeps the screen's attribution.
        plays.start(
            subject, origin: .dock, attribution: screenAttribution,
            lengthMs: heardLengthMs(snapshot.lengthMs, speedPercent: snapshot.speedPercent))
        plays.playing(snapshot.playing)
    }

    /// How a play on the recording screen reports.
    private var screenAttribution: PlayAttribution {
        PlayAttribution(
            source: .recordingScreen, queue: .single, trigger: .tap, kind: screenKind, service: nil, tune: screenTune)
    }

    private func report(_ ended: EndedPlay) {
        let recordingID = ended.subject.kind == .recording ? ended.subject.id : nil
        let linkID = ended.subject.kind == .link ? ended.subject.id : nil
        let attribution = ended.attribution
        let report = PlaybackReport(
            source: attribution.source, queue: attribution.queue, trigger: attribution.trigger,
            kind: attribution.kind, service: attribution.service, listenedMs: ended.listenedMs,
            completed: ended.endedBy == .finished, endedBy: ended.endedBy,
            systemControlled: ended.systemControlled, tuneID: nil, recordingID: recordingID, linkID: linkID,
            listID: ended.origin.listID)
        send(tune: attribution.tune, recordingID: recordingID, linkID: linkID) { tuneID in
            var report = report
            report.tuneID = tuneID
            return .playbackEnded(report)
        }
    }

    private func report(_ ended: EndedVisit) {
        let report = PracticeReport(
            source: screenSource, durationMs: ended.durationMs, usedLoops: ended.usedLoops,
            usedSpeed: ended.usedSpeed, usedPitch: ended.usedPitch, kind: screenKind, recordingID: ended.recordingID,
            tuneID: nil)
        send(tune: screenTune, recordingID: ended.recordingID, linkID: nil) { tuneID in
            var report = report
            report.tuneID = tuneID
            return .practiceEnded(report)
        }
    }

    /// Sends `event` under `tune`, or, when only the store knows it, under the tune the recording
    /// or link belongs to once the store answers. An unfiled item is asked about again, since it
    /// can be filed while it plays.
    private func send(
        tune: ReportedTune, recordingID: String?, linkID: String?,
        _ event: @escaping @Sendable (_ tuneID: String?) -> AnalyticsEvent
    ) {
        let analytics = analytics
        if case .known(let tuneID) = tune, tuneID != nil || quitting {
            analytics.send(event(tuneID))
            return
        }
        guard !quitting, let findTune = sink.writer?.findTune else {
            analytics.send(event(nil))
            return
        }
        Task { analytics.send(event(await findTune(recordingID, linkID))) }
    }
}
