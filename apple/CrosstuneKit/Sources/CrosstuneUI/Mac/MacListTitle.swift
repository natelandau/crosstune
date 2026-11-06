import CrosstuneDesign

#if os(macOS)
    import CrosstuneCommands
    import SwiftUI

    /// A list column's head: the list's name as the column title, then Play and Shuffle, then
    /// the line that says how many of its tunes will play. While selecting, the selection bar
    /// takes their place, and they keep their room hidden, so the rows never move when selection
    /// starts. With no play buttons, the room under the title is the selection bar's. `play` is
    /// nil while the list cannot offer playing at all, such as while it is empty.
    struct MacListTitle: View {
        let name: String
        let play: ListPlayAvailability?
        let isSelecting: Bool
        /// True while the list has tunes but has not yet read what can play, so the head keeps
        /// the play controls' room and the rows never move when the read finishes.
        var waitsForPlay = false

        /// The least room under the title: the selection bar's row, the same block the
        /// catalog's filter row takes under its title.
        static var slotHeight: CGFloat {
            MacStyle.columnBarInsets.top + MacStyle.columnBarHeight + MacStyle.columnBarInsets.bottom
        }

        @Environment(\.spacing) private var spacing

        var body: some View {
            VStack(alignment: .leading, spacing: 0) {
                ColumnTitle(name)
                    .columnTitleBaseline(.insetList)
                ZStack(alignment: .topLeading) {
                    // Holds the selection bar's height while the slot holds less.
                    Color.clear.frame(height: Self.slotHeight)
                    if let play {
                        playControls(play)
                            .padding(.vertical, MacStyle.columnBarInsets.top)
                            .opacity(isSelecting ? 0 : 1)
                            .disabled(isSelecting)
                            .accessibilityHidden(isSelecting)
                    } else if waitsForPlay {
                        playRoom.padding(.vertical, MacStyle.columnBarInsets.top)
                    }
                    if isSelecting {
                        SelectionBarSlot()
                            .padding(.top, MacStyle.columnBarInsets.top)
                    }
                }
            }
        }

        private func playControls(_ play: ListPlayAvailability) -> some View {
            VStack(alignment: .leading, spacing: spacing.stackGap) {
                if play.showsButtons { ListPlayButtons(offer: play) }
                playLine(play)
            }
        }

        /// The play controls' room, empty, while the list waits to read what can play.
        private var playRoom: some View {
            VStack(alignment: .leading, spacing: spacing.stackGap) {
                ActionButtonRow {
                    Button(ListPlayText.play, systemImage: "play.fill") {}
                        .actionButtonStyle(prominent: true)
                }
                Text(ListPlayText.none).font(MacStyle.secondary.weight(.medium))
            }
            .hidden()
            .accessibilityHidden(true)
        }

        private func playLine(_ play: ListPlayAvailability) -> some View {
            Text(ListPlayText.line(for: play.report))
                .monospacedDigit()
                .font(MacStyle.secondary.weight(.medium))
                .foregroundStyle(Palette.textSecondary)
        }
    }
#endif
