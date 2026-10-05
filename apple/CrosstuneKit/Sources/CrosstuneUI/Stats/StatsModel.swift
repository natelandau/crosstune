import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import Foundation
import GRDB
import Observation

/// The stats for the rows on the device, with the names the lines need.
public struct StatsView: Equatable, Sendable {
    public var stats: Stats
    /// The local date the stats were computed for, `YYYY-MM-DD`.
    public var today: String
    /// Every tune's title, deleted ones included, for the lines that name a tune.
    public var tuneTitles: [String: String]
    /// What a recording line calls a recording: its tune's title, else its label, else nil.
    public var recordingTitles: [String: String?]

    /// The title an on-this-day line names, from the tune or the recording it is about.
    public func title(for line: Stats.OnThisDay) -> String? {
        switch line.kind {
        case .firstRecording, .recording: recordingTitles[line.id] ?? nil
        case .firstTune, .tuneAdded, .learned: tuneTitles[line.id]
        }
    }

    /// Reads every row stats needs and computes them. Without `history` the event tables are left
    /// unread, so a summary neither waits on nor redraws for them.
    nonisolated static func fetch(
        _ db: Database, settingsRow: String, today: String, timeZone: TimeZone, history: Bool
    ) throws -> StatsView {
        let tunes = try Tune.fetchAll(db)
        let userTunes = try UserTune.fetchAll(db)
        let recordings = try Recording.fetchAll(db)
        let links = try RecordingLink.fetchAll(db)
        let lists = try TuneList.fetchAll(db)
        let scans = try ScanRecord.fetchAll(db)
        let settings = try UserSettings.fetchOne(db, key: settingsRow).flatMap { $0.deletedAt == nil ? $0 : nil }
        let plays = history ? try PlayEvent.fetchAll(db) : []
        let sessions = history ? try PracticeSession.fetchAll(db) : []
        let views = history ? try ScanView.fetchAll(db) : []
        let changes = history ? try StatusChange.fetchAll(db) : []
        let played = Set(settings?.instruments ?? [])
        let input = StatsInput(
            today: today, timeZone: timeZone.identifier,
            instruments: Vocabulary.instruments.filter(played.contains),
            tunes: tunes.map {
                StatsInput.Tune(
                    id: $0.id, title: $0.title, key: $0.key, modes: $0.modes, tuneType: $0.tuneType, genre: $0.genre,
                    timeSignature: $0.timeSignature, composer: $0.composer, tunings: .object($0.tunings),
                    deletedAt: $0.deletedAt?.iso)
            },
            userTunes: userTunes.map {
                StatsInput.UserTune(
                    id: $0.id, tuneID: $0.tuneID, status: $0.status, learnedFrom: $0.learnedFrom,
                    learnedOn: $0.learnedOn, archivedAt: $0.archivedAt?.iso, createdAt: $0.createdAt.iso,
                    deletedAt: $0.deletedAt?.iso)
            },
            // A recording's stats date is when it was added, the one date every recording has.
            recordings: recordings.map {
                StatsInput.Recording(
                    id: $0.id, tuneID: $0.tuneID, recordedAt: $0.addedAt.iso,
                    durationMs: $0.durationMs.map(Int.init),
                    trimStartMs: Int($0.trimStartMs), trimEndMs: $0.trimEndMs.map(Int.init),
                    deletedAt: $0.deletedAt?.iso)
            },
            recordingLinks: links.map { StatsInput.Row(id: $0.id, deletedAt: $0.deletedAt?.iso) },
            lists: lists.map { StatsInput.Row(id: $0.id, deletedAt: $0.deletedAt?.iso) },
            scans: scans.map { StatsInput.Scan(id: $0.id, tuneID: $0.tuneID, deletedAt: $0.deletedAt?.iso) },
            scanViews: views.map { StatsInput.ScanView(id: $0.id, startedAt: $0.startedAt.iso) },
            playEvents: plays.map {
                StatsInput.PlayEvent(id: $0.id, startedAt: $0.startedAt.iso, listenedMs: Int($0.listenedMs))
            },
            practiceSessions: sessions.map {
                StatsInput.PracticeSession(id: $0.id, startedAt: $0.startedAt.iso, durationMs: Int($0.durationMs))
            },
            statusChanges: changes.map {
                StatsInput.StatusChange(id: $0.id, fromStatus: $0.fromStatus, changedAt: $0.changedAt.iso)
            })
        let tuneTitles = Dictionary(tunes.map { ($0.id, $0.title) }, uniquingKeysWith: { first, _ in first })
        let recordingTitles = Dictionary(
            recordings.map { recording in
                (recording.id, recording.tuneID.flatMap { tuneTitles[$0] } ?? recording.label)
            },
            uniquingKeysWith: { first, _ in first })
        return StatsView(
            stats: computeStats(input), today: today, tuneTitles: tuneTitles, recordingTitles: recordingTitles)
    }
}

/// The stats screen's state, and the Settings summary row's: the stats for the rows on the
/// device, redrawn whenever a table they read changes.
@MainActor
@Observable
public final class StatsModel {
    private let engine: SyncEngine?
    private let live: LiveQuery<StatsView?>
    @ObservationIgnored private var pulled = false

    /// - Parameters:
    ///   - engine: Pulls the history once the screen appears. Nil where there is no account.
    ///   - now: The moment the screen opened. Its local date stays put while the screen is up,
    ///     even past midnight.
    ///   - history: False for a summary, which reads no history and never pulls it.
    public init(
        store: CrosstuneStore, engine: SyncEngine?, now: Date = Date(), timeZone: TimeZone = .current,
        history: Bool = true
    ) {
        self.engine = history ? engine : nil
        let settingsRow = settingsID(clerkUserID: store.userID)
        let today = localDate(Timestamp(now).iso, in: timeZone) ?? ""
        live = LiveQuery(store, initial: nil) { db in
            try StatsView.fetch(db, settingsRow: settingsRow, today: today, timeZone: timeZone, history: history)
        }
    }

    /// Nil until the rows have been read.
    public var view: StatsView? { live.value }

    public var stats: Stats? { view?.stats }

    /// The Settings row's one line, nil until the rows have been read.
    public var summaryLine: String? {
        view.map {
            StatsCopy.summaryLine(
                tunes: $0.stats.counts.tunes, lists: $0.stats.counts.lists, recordings: $0.stats.counts.recordings,
                scans: $0.stats.counts.scans, ms: $0.stats.recorded.totalMs)
        }
    }

    /// Starts the history pull, once per model. The screen keeps drawing from what is stored and
    /// redraws as pages land; a failure leaves the screen as it was.
    /// Returns the pull, or nil when there is none to start.
    @discardableResult
    public func appeared() -> Task<Void, Never>? {
        guard !pulled, let engine else { return nil }
        pulled = true
        return Task { await engine.pullEvents() }
    }
}
