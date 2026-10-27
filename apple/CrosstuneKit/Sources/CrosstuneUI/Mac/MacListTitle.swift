#if os(macOS)
    import CrosstuneCommands
    import SwiftUI

    /// A list column's head: the list's name as the column title, then one slot under it that
    /// holds the line that says how many of its tunes will play (which opens the sheet that says
    /// why the rest will not), the selection bar while selecting, or nothing. The slot is one
    /// height whatever it holds, so the rows never move when selection starts or the line goes.
    /// `play` is nil while the list cannot offer playing at all, such as while it is empty.
    struct MacListTitle: View {
        let name: String
        let play: ListPlayAvailability?
        let isSelecting: Bool

        /// The slot's height: the selection bar's row, the same block the catalog's filter row
        /// takes under its title.
        static var slotHeight: CGFloat {
            MacStyle.columnBarInsets.top + MacStyle.columnBarHeight + MacStyle.columnBarInsets.bottom
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 0) {
                ColumnTitle(name)
                    .columnTitleBaseline(.insetList)
                // The clear fill holds the slot's height while it holds nothing.
                ZStack(alignment: .topLeading) {
                    Color.clear
                    if isSelecting {
                        SelectionBarSlot()
                            .padding(.top, MacStyle.columnBarInsets.top)
                    } else if let play {
                        playLine(play)
                            .padding(.top, 4)
                    }
                }
                .frame(height: Self.slotHeight)
            }
        }

        private func playLine(_ play: ListPlayAvailability) -> some View {
            Button(action: play.onWhatPlays) {
                HStack(spacing: 4) {
                    Text(ListPlayText.line(for: play.report))
                        .monospacedDigit()
                    // Says the line opens more, since it reads as a plain caption.
                    Image(systemName: "info.circle")
                        .accessibilityHidden(true)
                }
                .font(MacStyle.secondary.weight(.medium))
                .contentShape(.rect)
            }
            .buttonStyle(WhatPlaysLineStyle())
            .help(ListPlayText.whatPlaysHint)
        }
    }

    /// The play line's look: secondary text, primary text under the pointer.
    private struct WhatPlaysLineStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            WhatPlaysLineBody(configuration: configuration)
        }
    }

    private struct WhatPlaysLineBody: View {
        let configuration: ButtonStyle.Configuration

        @State private var isHovered = false

        var body: some View {
            configuration.label
                .foregroundStyle(isHovered ? Palette.textPrimary : Palette.textSecondary)
                .opacity(configuration.isPressed ? 0.6 : 1)
                .onHover { isHovered = $0 }
        }
    }

    /// A list's Play and Shuffle, leading its pane bar's controls: Play the column's one primary
    /// action, Shuffle secondary. While the list plays, Play pauses and resumes it. Neither
    /// shows while the list has nothing to play and is not playing.
    struct MacListPlayButtons: View {
        let play: ListPlayAvailability

        var body: some View {
            if play.showsButtons {
                Group {
                    Button(action: play.onPlay) {
                        Label(play.playLabel, systemImage: play.playSymbol)
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.macPrimary)
                    .disabled(play.isPlayDisabled)
                    Button(action: play.onShuffle) {
                        Label(ListPlayText.shuffle, systemImage: "shuffle")
                    }
                    .buttonStyle(.macSecondary)
                    .disabled(play.isShuffleDisabled)
                }
                .labelStyle(.titleAndIcon)
            }
        }
    }
#endif
