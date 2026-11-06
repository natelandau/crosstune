import SwiftUI

/// A page's main actions side by side: on iPhone and iPad each takes an equal share of the
/// width, or the full width, stacked, where no labels fit side by side; on the Mac each keeps
/// its natural width, as the Mac's buttons do everywhere. Each
/// button takes `actionButtonStyle(prominent:)`, which sets its look and size.
package struct ActionButtonRow<Content: View>: View {
    @ViewBuilder package let content: Content

    package init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    @Environment(\.spacing) private var spacing

    package var body: some View {
        #if os(macOS)
            HStack(spacing: PaneBarLayout.spacing) { content }
                .labelStyle(.titleAndIcon)
        #else
            // A label never wraps or truncates: where equal columns are too narrow for every
            // label beside its glyph, the glyphs go, then the labels' insets tighten, then the
            // buttons stack at full width.
            ViewThatFits(in: .horizontal) {
                // Named, since a List row's default label style reports an ideal width without
                // its title, which would pass a row whose labels are cut off.
                columns.labelStyle(.titleAndIcon)
                columns.labelStyle(.titleOnly)
                columns.labelStyle(.titleOnly).environment(\.tightActionButtonLabels, true)
                VStack(spacing: spacing(10)) { content }
                    .labelStyle(.titleAndIcon)
            }
        #endif
    }

    #if !os(macOS)
        private var columns: some View {
            EqualColumns(spacing: spacing(10)) { content }
        }
    #endif
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
    /// Draws the action button row's labels closer to their buttons' edges, the last step before a
    /// label would be cut short.
    @Entry package var tightActionButtonLabels = false
}

extension View {
    /// The action button row's button look. On the Mac, the Mac's primary for the main button and its
    /// secondary for the rest, as a list's Play and Shuffle. Elsewhere, an accent-filled capsule for
    /// the main button and a tinted one for the rest. Never glass: the row sits in the page's
    /// content, and glass capsules side by side shade into each other.
    @ViewBuilder package func actionButtonStyle(prominent: Bool) -> some View {
        #if os(macOS)
            buttonStyle(MacButtonStyle(prominent ? .primary : .secondary))
        #else
            buttonStyle(ActionButtonStyle(prominent: prominent))
        #endif
    }
}

#if !os(macOS)
    private struct ActionButtonStyle: ButtonStyle {
        let prominent: Bool

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.colorScheme) private var colorScheme
        @Environment(\.tightActionButtonLabels) private var tight
        @Environment(\.spacing) private var spacing
        @ScaledMetric(relativeTo: .subheadline) private var height: CGFloat = 40

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(label)
                .lineLimit(1)
                // Fills the button's share of the row, so its capsule spans it.
                .frame(maxWidth: .infinity)
                .padding(.horizontal, spacing(tight ? 6 : 14))
                .frame(minHeight: height)
                .background(fill, in: .capsule)
                .disabledCapsuleRing(!isEnabled)
                .opacity(configuration.isPressed ? 0.6 : 1)
                .contentShape(.hoverEffect, .capsule)
                .hoverEffect(.highlight)
                .tapTarget(visibleHeight: height)
        }

        private var fill: Color {
            guard isEnabled else { return .clear }
            return prominent ? Palette.accentFill : Palette.tint(colorScheme)
        }

        private var label: Color {
            guard isEnabled else { return Palette.onDisabled }
            return prominent ? Palette.onAccentFill : Palette.onTint(colorScheme)
        }
    }
#endif
