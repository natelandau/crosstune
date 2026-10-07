import CrosstuneStore
import GRDB

/// The Settings row's figures: the counts and recorded time the stats screen leads with, counted
/// in SQL, so the row reads only the columns it shows and never runs the full stats.
struct StatsSummary: Equatable, Sendable {
    /// The tunes in the catalog, archived ones left out.
    let tunes: Int
    let lists: Int
    let recordings: Int
    /// The scans of tunes in the catalog.
    let scans: Int
    /// Every recording's length between its trim points.
    let recordedMs: Int
    /// The catalog's tunes by status, under the stats screen's three statuses.
    let byStatus: [String: Int]

    /// The row's one line.
    var line: String {
        StatsCopy.summaryLine(tunes: tunes, lists: lists, recordings: recordings, scans: scans, ms: recordedMs)
    }

    /// Counts what `computeStats` counts: a live user row over a live shared tune is in the
    /// catalog until it is archived, and a scan counts only when its tune is in the catalog.
    nonisolated static func fetch(_ db: Database) throws -> StatsSummary {
        let catalog = """
            SELECT u.tune_id, u.status
            FROM \(UserTune.databaseTableName) u
            JOIN \(Tune.databaseTableName) t ON t.id = u.tune_id AND t.deleted_at IS NULL
            WHERE u.deleted_at IS NULL AND u.archived_at IS NULL
            """
        let row = try Row.fetchOne(
            db,
            sql: """
                WITH catalog AS (\(catalog))
                SELECT
                    (SELECT COUNT(*) FROM catalog) AS tunes,
                    (SELECT COUNT(*) FROM catalog WHERE status = 'known') AS known,
                    (SELECT COUNT(*) FROM catalog WHERE status = 'learning') AS learning,
                    (SELECT COUNT(*) FROM catalog WHERE status = 'want_to_learn') AS want_to_learn,
                    (SELECT COUNT(*) FROM \(TuneList.databaseTableName) WHERE deleted_at IS NULL) AS lists,
                    (SELECT COUNT(*) FROM \(Recording.databaseTableName) WHERE deleted_at IS NULL) AS recordings,
                    (SELECT COALESCE(SUM(MAX(0, COALESCE(trim_end_ms, duration_ms, 0) - trim_start_ms)), 0)
                        FROM \(Recording.databaseTableName) WHERE deleted_at IS NULL) AS recorded_ms,
                    (SELECT COUNT(*) FROM \(ScanRecord.databaseTableName)
                        WHERE deleted_at IS NULL AND tune_id IN (SELECT tune_id FROM catalog)) AS scans
                """)
        guard let row else {
            return StatsSummary(tunes: 0, lists: 0, recordings: 0, scans: 0, recordedMs: 0, byStatus: [:])
        }
        return StatsSummary(
            tunes: row["tunes"], lists: row["lists"], recordings: row["recordings"], scans: row["scans"],
            recordedMs: row["recorded_ms"],
            byStatus: ["known": row["known"], "learning": row["learning"], "want_to_learn": row["want_to_learn"]])
    }

    /// The summary, read again on every write that changes it.
    @MainActor static func live(_ store: CrosstuneStore) -> LiveQuery<StatsSummary?> {
        LiveQuery(store, initial: nil) { try fetch($0) }
    }
}
