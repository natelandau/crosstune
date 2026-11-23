import CrosstuneCommands
import CrosstuneStore
import CrosstuneWidgetData
import Foundation
import GRDB

/// The part of the widget summary read from the list and settings tables.
struct WidgetListsPart: Equatable, Sendable {
    var lists: [WidgetList]
    var tunerReferenceLabel: String?
}

/// Reads what the widgets show from the store, in the order the app's own screens show it. The
/// recordings and the lists are read apart, each by its own observation, so a change to one
/// never reads the other again.
enum WidgetSummaryReader {
    /// Newest first, as the Recordings screen sorts by date recorded.
    nonisolated static func newestRecordings(_ db: Database) throws -> [WidgetRecording] {
        let live = try Recording.filter(Recording.CodingKeys.deletedAt == nil).fetchAll(db)
        let newest = live.sorted { RecordingArrangement.recordedOrder($0, $1, descending: true) < 0 }
            .prefix(WidgetSummary.maxRecordings)
        let tunes = try Tune.fetchAll(db, keys: Set(newest.compactMap(\.tuneID))).filter { $0.deletedAt == nil }
        let titles = Dictionary(tunes.map { ($0.id, $0.title) }, uniquingKeysWith: { first, _ in first })
        let files = Dictionary(
            try RecordingFile.fetchAll(db, keys: newest.map(\.id)).map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first })
        return newest.map { recording in
            // A recording whose tune was deleted elsewhere is unfiled, as the Recordings screen shows it.
            let tuneTitle = recording.tuneID.flatMap { titles[$0] }
            let milliseconds = recording.durationMs ?? files[recording.id]?.localDurationMs
            return WidgetRecording(
                id: recording.id,
                title: RecordingText.title(recording, tuneTitle: tuneTitle),
                isUnfiled: tuneTitle == nil,
                recordedAt: (recording.knownRecordedDate?.at ?? recording.addedAt).date,
                recordedPrecision: recording.knownRecordedDate?.precision ?? .time,
                duration: milliseconds.map { TimeInterval($0) / 1000 })
        }
    }

    /// Every list with its tunes as the list screen shows them, and the tuner's reference pitch.
    /// `settingsRow` is the account's settings row, whose instruments name each tune's tunings.
    nonisolated static func listsPart(_ db: Database, settingsRow: String) throws -> WidgetListsPart {
        let settings = try SettingsSummaries.fetch(db, settingsRow: settingsRow)
        return WidgetListsPart(
            lists: try lists(db, instruments: settings.instruments),
            tunerReferenceLabel: TunerText.referenceLabel(settings.tunerA4Hz))
    }

    /// Each live list in the musician's order, with its live tunes in list order, archived ones
    /// only under the Show archived setting every list shares. Reads only the tune columns shown,
    /// so an edit to anything else about a tune reads nothing again.
    nonisolated private static func lists(_ db: Database, instruments: Set<String>) throws -> [WidgetList] {
        let showArchived = ListContents.showsArchived(in: db)
        let lists = activeByPosition(try TuneList.fetchAll(db))
        let tunes = try ListTuneColumns.fetchAll(
            db,
            sql: """
                SELECT i.list_id, t.id, t.title, t.key, t.modes, t.tune_type, t.tunings,
                    ut.archived_at IS NOT NULL AS is_archived
                FROM list_items i
                JOIN user_tunes ut ON ut.id = i.user_tune_id AND ut.deleted_at IS NULL
                JOIN tunes t ON t.id = ut.tune_id AND t.deleted_at IS NULL
                WHERE i.deleted_at IS NULL
                ORDER BY i.position, i.rowid
                """)
        let shown = Dictionary(grouping: tunes.filter { showArchived || !$0.isArchived }, by: \.listID)
        return lists.map { list in
            WidgetList(
                id: list.id, name: list.name,
                tunes: (shown[list.id] ?? []).map {
                    WidgetListTune(id: $0.id, title: $0.title, detail: detail($0, instruments: instruments))
                })
        }
    }

    /// "D · Reel · AEAE": the key and the tunings as the tune row shows them, with the type
    /// between, as the share extension's tune list names it.
    nonisolated private static func detail(_ tune: ListTuneColumns, instruments: Set<String>) -> String? {
        TuneDetailText.joined([
            KeyModeText(key: tune.key, modes: tune.modes)?.shown, TuneDetailText.type(tune.tuneType),
            TuningText.row(tune.tunings, instruments: instruments),
        ])
    }
}

/// The columns of a list's tune that a List widget row shows.
private struct ListTuneColumns: Decodable, FetchableRecord {
    let listID: String
    let id: String
    let title: String
    let key: String?
    let modes: [String]
    let tuneType: String?
    let tunings: JSONObject
    let isArchived: Bool

    enum CodingKeys: String, CodingKey {
        case listID = "list_id"
        case id, title, key, modes
        case tuneType = "tune_type"
        case tunings
        case isArchived = "is_archived"
    }
}
