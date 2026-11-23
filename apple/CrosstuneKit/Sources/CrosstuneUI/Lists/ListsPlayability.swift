import CrosstuneAudio
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
            return try snapshot(db, lists: lists, settingsID: settingsID)
        }

        /// List `listID` alone, with no lists when it is gone.
        nonisolated static func fetch(_ db: Database, listID: String, settingsID: String) throws -> Snapshot {
            try snapshot(
                db, lists: [try ListContents.fetch(db, listID: listID)].compactMap(\.self), settingsID: settingsID)
        }

        nonisolated private static func snapshot(_ db: Database, lists: [ListContents], settingsID: String) throws
            -> Snapshot
        {
            let showArchived = ListContents.showsArchived(in: db)
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
            let shown = contents.entries.shown(showArchived: snapshot.showArchived)
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

/// What a start of a list read from the store found.
enum ListStartOutcome {
    case started
    case listGone
    /// Nothing in the list can play now, as when every tune needs a network or a plan.
    case nothingPlays
}

extension ListPlayback {
    /// Plays list `listID` as Play and Shuffle on the Lists screen do, from tune `tuneID` when
    /// the list holds it, else from the top. Use it where the list's playability is not already
    /// read, as for a widget tap. `recordingsPlay` false plays no recording, as on a free plan.
    func start(
        listID: String, from store: CrosstuneStore, online: Bool, appleMusic: AppleMusic?, recordingsPlay: Bool,
        shuffled: Bool, at tuneID: String?
    ) async throws -> ListStartOutcome {
        let settings = settingsID(clerkUserID: store.userID)
        let snapshot = try await store.read { db in
            try ListsPlayability.Snapshot.fetch(db, listID: listID, settingsID: settings)
        }
        guard let contents = snapshot.lists.first else { return .listGone }
        let fullTracks = online ? await appleMusic?.access.current() == .fullTracks : false
        let reports = ListsPlayability.reports(
            snapshot, canStart: true, fullTracks: fullTracks, online: online, recordingsPlay: recordingsPlay)
        guard let report = reports[listID] else { return .nothingPlays }
        start(listID: listID, name: contents.list.name, report: report, shuffled: shuffled, at: tuneID)
        return .started
    }
}
