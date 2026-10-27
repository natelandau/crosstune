import CrosstuneCommands
import CrosstuneDesign
import SwiftUI

/// Words the list's play controls show.
public enum ListPlayText {
    public static let play = MediaText.play
    public static let pause = MediaText.pause
    public static let shuffle = "Shuffle"
    public static let none = "No tunes in this list can play"
    public static let whatPlaysHint = "Shows which tunes play in a list and why the others do not."

    public static func count(playable: Int, total: Int) -> String {
        "\(playable) of \(total) tunes will play"
    }

    /// The line under the buttons for what a list can play now.
    public static func line(for report: PlaylistReport) -> String {
        report.playable.isEmpty ? none : count(playable: report.playable.count, total: report.total)
    }
}

/// What a list can play now, and what its Play, Shuffle, and what-plays line do.
struct ListPlayAvailability {
    /// The list as it plays, which turns Play into a pause and resume control.
    struct Playing {
        let isPlaying: Bool
        /// False while the next tune loads, when the player still holds the one being left.
        let isSettled: Bool
    }

    let report: PlaylistReport
    /// False when no playlist player is available, or while a recording is being recorded.
    let canStart: Bool
    /// Non-nil while this list plays.
    var playing: Playing? = nil
    /// Starts the list, or, while it plays, pauses and resumes it.
    let onPlay: () -> Void
    let onShuffle: () -> Void
    let onWhatPlays: () -> Void

    /// Play and Shuffle show while the list has a tune to play, or while it plays.
    var showsButtons: Bool { playing != nil || !report.playable.isEmpty }
    var showsPause: Bool { playing?.isPlaying == true }
    var playLabel: String { showsPause ? ListPlayText.pause : ListPlayText.play }
    var playSymbol: String { showsPause ? "pause.fill" : "play.fill" }
    var isPlayDisabled: Bool { !canStart || playing?.isSettled == false }
    var isShuffleDisabled: Bool { !canStart || report.playable.isEmpty }
}

/// Play and Shuffle for a list, with the line that says how many of its tunes will play and
/// opens the sheet that says why the rest will not. While the list plays, Play pauses and
/// resumes it. With nothing to play, and the list not playing, only the line shows. It is the
/// list's first row, so it sets no margins of its own.
struct ListPlayControls: View {
    let offer: ListPlayAvailability

    @Environment(\.spacing) private var spacing

    var body: some View {
        VStack(alignment: .leading, spacing: spacing.stackGap) {
            if offer.showsButtons { ListPlayButtons(offer: offer) }
            Button(action: offer.onWhatPlays) {
                Text(ListPlayText.line(for: offer.report))
                    .font(.platform(.footnote))
                    .foregroundStyle(.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: minimumTapTarget, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(ListPlayText.whatPlaysHint)
        }
    }
}

/// A list's Play and Shuffle in one action button row: Play the main action, Shuffle secondary.
struct ListPlayButtons: View {
    let offer: ListPlayAvailability

    @Environment(\.drawsGlass) private var drawsGlass

    var body: some View {
        ActionButtonRow {
            Button(action: offer.onPlay) {
                Label(offer.playLabel, systemImage: offer.playSymbol)
                    .contentTransition(.symbolEffect(.replace))
                    .fillsShare()
            }
            .actionButtonStyle(prominent: true, glass: drawsGlass)
            .disabled(offer.isPlayDisabled)
            Button(action: offer.onShuffle) {
                Label(ListPlayText.shuffle, systemImage: "shuffle")
                    .fillsShare()
            }
            .actionButtonStyle(prominent: false, glass: drawsGlass)
            .disabled(offer.isShuffleDisabled)
        }
    }
}

extension View {
    /// Spans the button's share of the row; a Mac button keeps its natural width.
    fileprivate func fillsShare() -> some View {
        #if os(macOS)
            self
        #else
            frame(maxWidth: .infinity)
        #endif
    }
}
