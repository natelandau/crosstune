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

/// Play and Shuffle for a list, with the line that says how many of its tunes will play and
/// opens the sheet that says why the rest will not.
struct ListPlayControls: View {
    let report: PlaylistReport
    /// False when no playlist player is available, or while a take is being recorded.
    let canStart: Bool
    let onPlay: () -> Void
    let onShuffle: () -> Void
    let onWhatPlays: () -> Void

    @Environment(\.spacing) private var spacing

    var body: some View {
        let disabled = report.playable.isEmpty || !canStart
        VStack(alignment: .leading, spacing: spacing.stackGap) {
            HStack(spacing: spacing(3)) {
                Button(action: onPlay) {
                    Label(ListPlayText.play, systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                Button(action: onShuffle) {
                    Label(ListPlayText.shuffle, systemImage: "shuffle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .disabled(disabled)
            Button(action: onWhatPlays) {
                Text(ListPlayText.line(for: report))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint(ListPlayText.whatPlaysHint)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, spacing.stackGap)
    }
}
