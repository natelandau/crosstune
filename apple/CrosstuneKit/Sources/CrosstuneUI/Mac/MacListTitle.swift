#if os(macOS)
    import CrosstuneCommands
    import SwiftUI

    /// A list column's head: the list's name as the column title with Play, Shuffle, and the
    /// list's own `actions` trailing on its line, then the line that says how many of its tunes
    /// will play and opens the sheet that says why the rest will not. `play` is nil while the
    /// list cannot offer playing at all, such as while it is empty or selecting.
    struct MacListTitle<Actions: View>: View {
        let name: String
        let play: ListPlayOffer?
        @ViewBuilder let actions: Actions

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                TitleLine {
                    ColumnTitle(name)
                    HStack(spacing: 8) {
                        if let play {
                            Group {
                                Button(action: play.onPlay) {
                                    Label(ListPlayText.play, systemImage: "play.fill")
                                }
                                .buttonStyle(ProminentPaneButtonStyle())
                                Button(action: play.onShuffle) {
                                    Label(ListPlayText.shuffle, systemImage: "shuffle")
                                }
                                .buttonStyle(PaneButtonStyle())
                            }
                            .labelStyle(.titleAndIcon)
                            .disabled(play.report.playable.isEmpty || !play.canStart)
                        }
                        actions.paneControls()
                    }
                    .fixedSize()
                }
                if let play {
                    Button(action: play.onWhatPlays) {
                        Text(ListPlayText.line(for: play.report))
                            .font(MacStyle.secondary)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(ListPlayText.whatPlaysHint)
                }
            }
        }
    }

    /// The column title with its controls trailing on the same line, or under it once the
    /// title would have to truncate to keep them there.
    private struct TitleLine: Layout {
        private static let spacing: CGFloat = 12
        private static let lineGap: CGFloat = 6

        func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
            guard let title = subviews.first else { return .zero }
            let titleIdeal = title.sizeThatFits(.unspecified)
            guard subviews.count > 1 else {
                return CGSize(
                    width: proposal.width ?? titleIdeal.width,
                    height: title.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil)).height)
            }
            let trailing = subviews[1].sizeThatFits(.unspecified)
            let oneLine = titleIdeal.width + Self.spacing + trailing.width
            let width = proposal.width ?? oneLine
            if oneLine <= width {
                return CGSize(width: width, height: max(titleIdeal.height, trailing.height))
            }
            let titleHeight = title.sizeThatFits(ProposedViewSize(width: width, height: nil)).height
            return CGSize(width: width, height: titleHeight + Self.lineGap + trailing.height)
        }

        func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
            guard let title = subviews.first else { return }
            guard subviews.count > 1 else {
                title.place(
                    at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
                return
            }
            let titleIdeal = title.sizeThatFits(.unspecified)
            let trailing = subviews[1].sizeThatFits(.unspecified)
            if titleIdeal.width + Self.spacing + trailing.width <= bounds.width {
                title.place(
                    at: CGPoint(x: bounds.minX, y: bounds.midY), anchor: .leading,
                    proposal: ProposedViewSize(width: bounds.width - trailing.width - Self.spacing, height: nil))
                subviews[1].place(
                    at: CGPoint(x: bounds.maxX, y: bounds.midY), anchor: .trailing, proposal: .unspecified)
            } else {
                let titleHeight = title.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil)).height
                title.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: titleHeight))
                subviews[1].place(
                    at: CGPoint(x: bounds.minX, y: bounds.minY + titleHeight + Self.lineGap), proposal: .unspecified)
            }
        }
    }

    /// A pane control that leads its set: a slate capsule at the pane bar's
    /// height. A bordered prominent button's bezel keeps its own height whatever the frame.
    struct ProminentPaneButtonStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            ProminentPaneButtonBody(configuration: configuration)
        }
    }

    private struct ProminentPaneButtonBody: View {
        let configuration: ButtonStyle.Configuration

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.colorScheme) private var scheme

        var body: some View {
            configuration.label
                .font(MacStyle.body.weight(.semibold))
                .lineLimit(1)
                .foregroundStyle(MacStyle.onAccent(scheme))
                .padding(.horizontal, 12)
                .frame(minWidth: MacStyle.paneIconWidth)
                .frame(height: MacStyle.paneControlHeight)
                .background(MacStyle.accent, in: .capsule)
                .contentShape(.capsule)
                .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
        }
    }
#endif
