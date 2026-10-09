import CrosstuneCommands
import CrosstuneStore
import GRDB
import SwiftUI

/// What each list on the iPhone lists screen would play now, so a row offers Play only for a
/// list with a tune that plays.
enum ListsPlayOffers {
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
    /// subscription skip, and while `canStart` is false: a take records, or no playlist player
    /// is there.
    static func reports(
        _ snapshot: Snapshot?, canStart: Bool, fullTracks: Bool?, online: Bool
    ) -> [String: PlaylistReport] {
        guard let snapshot, let fullTracks, canStart else { return [:] }
        var reports: [String: PlaylistReport] = [:]
        for contents in snapshot.lists {
            let shown = snapshot.showArchived ? contents.entries : contents.entries.filter { !$0.isArchived }
            let report = playlistReport(
                entries: shown.map { $0.playlistEntry(online: online) }, playFirst: snapshot.playFirst,
                fullTracks: fullTracks, online: online)
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

/// A list row's own play control on the lists screen, trailing. It plays the list, or,
/// on the list that plays, pauses and resumes it as a playing tune's row does. A list with
/// nothing to play keeps the slot empty, so every row's text ends in one place.
struct ListsRowPlayButton: View {
    let summary: ListSummary
    /// What the list would play, or nil when it has nothing to play or cannot start now.
    let report: PlaylistReport?
    let onPlay: (PlaylistReport) -> Void

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(ListPlayback.self) private var listPlayback: ListPlayback?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let slot: CGFloat = 44

    var body: some View {
        if listPlayback?.listID == summary.id {
            // Until the tune loads, the transport still plays the tune being left.
            let settled = listPlayback?.isSettled ?? false
            let isPlaying = settled && player?.transport?.isPlaying == true
            Button {
                guard settled, let transport = player?.transport else { return }
                if transport.isPlaying { transport.pause() } else { transport.play() }
            } label: {
                Image(systemName: ListRowPlay.nowPlayingSymbol(isPlaying: isPlaying))
                    .foregroundStyle(.tint)
                    .symbolEffect(.variableColor.iterative, options: .repeating, isActive: isPlaying && !reduceMotion)
                    .font(.title3)
                    .frame(minWidth: slot, minHeight: slot)
                    .contentShape(.rect)
            }
            .buttonStyle(.borderless)
            .disabled(!settled)
            .accessibilityLabel(
                isPlaying
                    ? ListsPlayOffers.pauseLabel(listName: summary.name)
                    : ListsPlayOffers.playLabel(listName: summary.name))
        } else if let report {
            Button {
                onPlay(report)
            } label: {
                Image(systemName: "play.fill")
                    .font(.title3)
                    .frame(minWidth: slot, minHeight: slot)
                    .contentShape(.rect)
            }
            // Borderless, so the tap stays the button's and never opens the row.
            .buttonStyle(.borderless)
            .accessibilityLabel(ListsPlayOffers.playLabel(listName: summary.name))
        } else {
            Color.clear
                .frame(width: slot, height: slot)
                .accessibilityHidden(true)
        }
    }
}
