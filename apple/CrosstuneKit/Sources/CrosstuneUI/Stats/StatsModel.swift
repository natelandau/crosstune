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

    /// Reads every row stats needs and computes them.
    nonisolated static func fetch(
        _ db: Database, settingsRow: String, today: String, timeZone: TimeZone
    ) throws -> StatsView {
        let tunes = try StatsRows.Tune.fetchAll(db)
        let userTunes = try StatsRows.UserTune.fetchAll(db)
        let recordings = try StatsRows.Recording.fetchAll(db)
        let links = try StatsRows.Live.fetchAll(db, sql: StatsRows.Live.sql(RecordingLink.databaseTableName))
        let lists = try StatsRows.Live.fetchAll(db, sql: StatsRows.Live.sql(TuneList.databaseTableName))
        let scans = try StatsRows.Scan.fetchAll(db)
        let settings = try UserSettings.fetchOne(db, key: settingsRow).flatMap { $0.deletedAt == nil ? $0 : nil }
        // Only the heatmap reads the history, so a row its weeks cannot hold is never read.
        let bounds = heatmapInstantBounds(today: today)
        func inWindow<Row: TableRecord>(_ row: Row.Type, _ column: Column) -> QueryInterfaceRequest<Row> {
            guard let bounds else { return Row.none() }
            return Row.filter(column >= bounds.from && column < bounds.to)
        }
        let plays = try inWindow(StatsRows.Play.self, Column("started_at")).fetchAll(db)
        let sessions = try inWindow(StatsRows.Session.self, Column("started_at")).fetchAll(db)
        let views = try inWindow(StatsRows.View.self, Column("started_at")).fetchAll(db)
        let changes = try inWindow(StatsRows.Change.self, Column("changed_at")).fetchAll(db)
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

/// The columns of each table stats read, so a write to any other column leaves the stats alone.
/// The catalog tables read in row order, as a whole-row read does, for the ties the stats keep in
/// the order rows come.
private enum StatsRows {
    struct Tune: Decodable, FetchableRecord, TableRecord {
        static let databaseTableName = SyncTable.tunes.rawValue
        static var databaseSelection: [any SQLSelectable] { CodingKeys.allCases }
        static func fetchAll(_ db: Database) throws -> [Self] { try all().order(Column.rowID).fetchAll(db) }

        var id: String
        var title: String
        var key: String?
        var modes: [String]
        var tuneType: String?
        var genre: String?
        var timeSignature: String?
        var composer: String?
        var tunings: JSONObject
        var deletedAt: Timestamp?

        enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
            case id, title, key, modes, genre, composer, tunings
            case tuneType = "tune_type"
            case timeSignature = "time_signature"
            case deletedAt = "deleted_at"
        }
    }

    struct UserTune: Decodable, FetchableRecord, TableRecord {
        static let databaseTableName = SyncTable.userTunes.rawValue
        static var databaseSelection: [any SQLSelectable] { CodingKeys.allCases }
        static func fetchAll(_ db: Database) throws -> [Self] { try all().order(Column.rowID).fetchAll(db) }

        var id: String
        var tuneID: String
        var status: String
        var learnedFrom: String?
        var learnedOn: String?
        var archivedAt: Timestamp?
        var createdAt: Timestamp
        var deletedAt: Timestamp?

        enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
            case id, status
            case tuneID = "tune_id"
            case learnedFrom = "learned_from"
            case learnedOn = "learned_on"
            case archivedAt = "archived_at"
            case createdAt = "created_at"
            case deletedAt = "deleted_at"
        }
    }

    struct Recording: Decodable, FetchableRecord, TableRecord {
        static let databaseTableName = SyncTable.recordings.rawValue
        static var databaseSelection: [any SQLSelectable] { CodingKeys.allCases }
        static func fetchAll(_ db: Database) throws -> [Self] { try all().order(Column.rowID).fetchAll(db) }

        var id: String
        var tuneID: String?
        var label: String?
        var addedAt: Timestamp
        var durationMs: Int64?
        var trimStartMs: Int64
        var trimEndMs: Int64?
        var deletedAt: Timestamp?

        enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
            case id, label
            case tuneID = "tune_id"
            case addedAt = "added_at"
            case durationMs = "duration_ms"
            case trimStartMs = "trim_start_ms"
            case trimEndMs = "trim_end_ms"
            case deletedAt = "deleted_at"
        }
    }

    /// A link or a list, which stats only count.
    struct Live: Decodable, FetchableRecord {
        var id: String
        var deletedAt: Timestamp?

        enum CodingKeys: String, CodingKey {
            case id
            case deletedAt = "deleted_at"
        }

        static func sql(_ table: String) -> String { "SELECT id, deleted_at FROM \(table) ORDER BY rowid" }
    }

    struct Scan: Decodable, FetchableRecord, TableRecord {
        static let databaseTableName = ScanRecord.databaseTableName
        static var databaseSelection: [any SQLSelectable] { CodingKeys.allCases }
        static func fetchAll(_ db: Database) throws -> [Self] { try all().order(Column.rowID).fetchAll(db) }

        var id: String
        var tuneID: String
        var deletedAt: Timestamp?

        enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
            case id
            case tuneID = "tune_id"
            case deletedAt = "deleted_at"
        }
    }

    struct Play: Decodable, FetchableRecord, TableRecord {
        static let databaseTableName = PlayEvent.databaseTableName
        static var databaseSelection: [any SQLSelectable] { CodingKeys.allCases }

        var id: String
        var startedAt: Timestamp
        var listenedMs: Int64

        enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
            case id
            case startedAt = "started_at"
            case listenedMs = "listened_ms"
        }
    }

    struct Session: Decodable, FetchableRecord, TableRecord {
        static let databaseTableName = PracticeSession.databaseTableName
        static var databaseSelection: [any SQLSelectable] { CodingKeys.allCases }

        var id: String
        var startedAt: Timestamp
        var durationMs: Int64

        enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
            case id
            case startedAt = "started_at"
            case durationMs = "duration_ms"
        }
    }

    struct View: Decodable, FetchableRecord, TableRecord {
        static let databaseTableName = ScanView.databaseTableName
        static var databaseSelection: [any SQLSelectable] { CodingKeys.allCases }

        var id: String
        var startedAt: Timestamp

        enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
            case id
            case startedAt = "started_at"
        }
    }

    struct Change: Decodable, FetchableRecord, TableRecord {
        static let databaseTableName = StatusChange.databaseTableName
        static var databaseSelection: [any SQLSelectable] { CodingKeys.allCases }

        var id: String
        var fromStatus: String?
        var changedAt: Timestamp

        enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
            case id
            case fromStatus = "from_status"
            case changedAt = "changed_at"
        }
    }
}

/// The stats screen's state: the stats for the rows on the device, redrawn whenever a table they
/// read changes.
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
    public init(store: CrosstuneStore, engine: SyncEngine?, now: Date = Date(), timeZone: TimeZone = .current) {
        self.engine = engine
        let settingsRow = settingsID(clerkUserID: store.userID)
        let today = localDate(Timestamp(now).iso, in: timeZone) ?? ""
        live = LiveQuery(store, initial: nil) { db in
            try StatsView.fetch(db, settingsRow: settingsRow, today: today, timeZone: timeZone)
        }
    }

    /// Nil until the rows have been read.
    public var view: StatsView? { live.value }

    public var stats: Stats? { view?.stats }

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
