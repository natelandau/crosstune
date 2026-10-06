import CrosstuneCommands
import SwiftUI

/// Words the list's play controls show.
public enum ListPlayText {
    public static let play = MediaText.play
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
struct ListPlayOffer {
    let report: PlaylistReport
    /// False when no playlist player is available, or while a take is being recorded.
    let canStart: Bool
    let onPlay: () -> Void
    let onShuffle: () -> Void
    let onWhatPlays: () -> Void
}

/// Play and Shuffle for a list, with the line that says how many of its tunes will play and
/// opens the sheet that says why the rest will not. It is the list's first row, so it sets
/// no margins of its own.
struct ListPlayControls: View {
    let offer: ListPlayOffer

    @Environment(\.spacing) private var spacing
    @Environment(\.drawsGlass) private var drawsGlass

    var body: some View {
        let disabled = offer.report.playable.isEmpty || !offer.canStart
        VStack(alignment: .leading, spacing: spacing.stackGap) {
            HStack(spacing: spacing(3)) {
                Button(action: offer.onPlay) {
                    Label(ListPlayText.play, systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .playControlStyle(prominent: true, glass: drawsGlass)
                Button(action: offer.onShuffle) {
                    Label(ListPlayText.shuffle, systemImage: "shuffle")
                        .frame(maxWidth: .infinity)
                }
                .playControlStyle(prominent: false, glass: drawsGlass)
            }
            .controlSize(.large)
            .disabled(disabled)
            Button(action: offer.onWhatPlays) {
                Text(ListPlayText.line(for: offer.report))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(ListPlayText.whatPlaysHint)
        }
    }
}

extension View {
    /// Play is a prominent slate capsule and Shuffle a glass one. Where glass cannot draw,
    /// the bordered styles stand in.
    @ViewBuilder fileprivate func playControlStyle(prominent: Bool, glass: Bool) -> some View {
        switch (prominent, glass) {
        case (true, true): buttonStyle(.slateGlassProminent)
        case (false, true): buttonStyle(.glass)
        case (true, false): buttonStyle(.slateProminent)
        case (false, false): buttonStyle(.bordered)
        }
    }
}
