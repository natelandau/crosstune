import CrosstuneCommands
import CrosstuneDesign
import CrosstuneStore
import GRDB
import SwiftUI

/// What each list on the iPhone lists screen would play now, so a row offers Play only for a
/// list with a tune that plays.
enum ListsPlayability {
    /// Every live list's tunes, with the settings a playlist reads, from one read.
    struct Snapshot: Equatable, Sendable {
        var lists: [ListContents] = []
        var showArchived = false
        var playFirst = UserSettings.defaultPlayFirst

        nonisolated static func fetch(_ db: Database, settingsID: String) throws -> Snapshot {
            let lists = try activeByPosition(try TuneList.fetchAll(db)).compactMap { list in
                try ListContents.fetch(db, listID: list.id)
            }
            // Anything but a stored true reads as off, as the web reads it.
            let showArchived = (try? MetaKey.listShowArchived.value(in: db, as: Bool.self)) == true
            let playFirst = CrosstuneCommands.storedPlayFirst(try UserSettings.fetchOne(db, key: settingsID))
            return Snapshot(lists: lists, showArchived: showArchived, playFirst: playFirst)
        }
    }

    /// The report for each list with a tune that plays, by list id. A list missing here offers no
    /// Play. Empty until `snapshot` and `fullTracks` have read, so a count never flashes a
    /// subscription skip, and while `canStart` is false: a recording is under way, or no playlist player
    /// is there. `recordingsPlay` false plays no recording, as on a free plan.
    static func reports(
        _ snapshot: Snapshot?, canStart: Bool, fullTracks: Bool?, online: Bool, recordingsPlay: Bool = true
    ) -> [String: PlaylistReport] {
        guard let snapshot, let fullTracks, canStart else { return [:] }
        var reports: [String: PlaylistReport] = [:]
        for contents in snapshot.lists {
            let shown = snapshot.showArchived ? contents.entries : contents.entries.filter { !$0.isArchived }
            let report = playlistReport(
                entries: shown.map { $0.playlistEntry(online: online) }, playFirst: snapshot.playFirst,
                fullTracks: fullTracks, online: online, recordingsPlay: recordingsPlay)
            if !report.playable.isEmpty { reports[contents.list.id] = report }
        }
        return reports
    }

    /// "Play Waltzes", a list row's play control.
    static func playLabel(listName: String) -> String {
        "\(MediaText.play) \(listName)"
    }

    /// "Pause Waltzes", the playing list's row control while it plays.
    static func pauseLabel(listName: String) -> String {
        "\(MediaText.pause) \(listName)"
    }
}
