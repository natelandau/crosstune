import SwiftUI

/// A page's main actions side by side: on iPhone and iPad each takes an equal share of the
/// width; on the Mac each keeps its natural width, as the Mac's buttons do everywhere. Set the
/// controls' size here so every page's row reads the same.
struct VerbRow<Content: View>: View {
    @ViewBuilder let content: Content

    @Environment(\.spacing) private var spacing

    var body: some View {
        #if os(macOS)
            HStack(spacing: PaneBarLayout.spacing) { content }
                .labelStyle(.titleAndIcon)
        #else
            EqualColumns(spacing: spacing(3)) { content }
                .controlSize(.large)
        #endif
    }
}

#if !os(macOS)
    /// Columns of one width side by side. Its ideal width gives every column its widest
    /// member's ideal width, so a `ViewThatFits` around it takes the next option as soon as one
    /// label would be squeezed, rather than once the labels' total no longer fits.
    private struct EqualColumns: Layout {
        let spacing: CGFloat

        func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
            guard !subviews.isEmpty else { return .zero }
            let gaps = spacing * CGFloat(subviews.count - 1)
            let width =
                proposal.width
                ?? subviews.map { $0.sizeThatFits(.unspecified).width }.max().map {
                    $0 * CGFloat(subviews.count) + gaps
                } ?? 0
            let column = max(0, (width - gaps) / CGFloat(subviews.count))
            let height = subviews.map { $0.sizeThatFits(ProposedViewSize(width: column, height: nil)).height }.max()
            return CGSize(width: width, height: height ?? 0)
        }

        func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
            guard !subviews.isEmpty else { return }
            let gaps = spacing * CGFloat(subviews.count - 1)
            let column = max(0, (bounds.width - gaps) / CGFloat(subviews.count))
            for (index, subview) in subviews.enumerated() {
                let x = bounds.minX + CGFloat(index) * (column + spacing) + column / 2
                subview.place(
                    at: CGPoint(x: x, y: bounds.midY), anchor: .center,
                    proposal: ProposedViewSize(width: column, height: bounds.height))
            }
        }
    }
#endif

extension EnvironmentValues {
    /// Draws the verb row's labels closer to their buttons' edges, the last step before a
    /// label would be cut short.
    @Entry var tightVerbLabels = false
}

extension View {
    /// The verb row's button look. On the Mac, the Mac's primary for the main verb and its
    /// secondary for the rest, as a list's Play and Shuffle. Elsewhere, a prominent accent capsule
    /// for the main verb and a glass one for the rest; where glass cannot draw, the bordered
    /// styles stand in.
    @ViewBuilder func verbStyle(prominent: Bool, glass: Bool) -> some View {
        #if os(macOS)
            buttonStyle(MacButtonStyle(prominent ? .primary : .secondary))
        #else
            switch (prominent, glass) {
            case (true, true): buttonStyle(.accentGlassProminent)
            case (false, true): buttonStyle(.glass)
            case (true, false): buttonStyle(.accentProminent)
            case (false, false): buttonStyle(.bordered)
            }
        #endif
    }

    /// Fills the verb's share of the row, so its capsule spans it, on one line. A Mac verb keeps
    /// its natural width.
    func verbLabelWidth() -> some View {
        #if os(macOS)
            self
        #else
            modifier(VerbLabelWidth())
        #endif
    }
}

#if !os(macOS)
    private struct VerbLabelWidth: ViewModifier {
        @Environment(\.tightVerbLabels) private var tight

        func body(content: Content) -> some View {
            content
                .lineLimit(1)
                // Eats into the button style's own horizontal inset, which no style offers to set.
                .padding(.horizontal, tight ? -8 : 0)
                .frame(maxWidth: .infinity)
        }
    }
#endif
