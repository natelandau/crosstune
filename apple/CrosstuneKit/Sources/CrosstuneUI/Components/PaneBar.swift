#if os(macOS)
    import SwiftUI

    extension View {
        /// Pins `controls` across the top of this split view column, trailing, as its toolbar.
        /// A Mac toolbar puts a content column's trailing items over the detail column, so a
        /// column's own controls sit here, over the pane they act on.
        func paneBar(@ViewBuilder _ controls: () -> some View) -> some View {
            modifier(PaneBar(leading: EmptyView(), slot: 0, controls: controls()))
        }

        /// ``paneBar(_:)`` with `leading`, such as a search field, filling the bar up to a
        /// trailing slot `slot` wide that holds the controls. The slot is the column's own and
        /// never changes, so the leading view keeps one width whatever the controls are.
        func paneBar(
            slot: CGFloat, @ViewBuilder leading: () -> some View, @ViewBuilder _ controls: () -> some View
        ) -> some View {
            modifier(PaneBar(leading: leading(), slot: slot, controls: controls()))
        }
    }

    private struct PaneBar<Leading: View, Controls: View>: ViewModifier {
        let leading: Leading
        let slot: CGFloat
        let controls: Controls

        @Environment(\.spacing) private var spacing

        func body(content: Content) -> some View {
            content.safeAreaBar(edge: .top) {
                // A bar keeps its height with nothing in it, so every column's content, and its
                // title, starts at one height whatever the bar holds. The controls are styled
                // before the split, since a menu reads its indicator from where it resolves.
                Group(subviews: leading) { leadingViews in
                    Group(subviews: controls.paneControls()) { subviews in
                        PaneBarLayout(slot: slot) {
                            leadingViews
                            HStack(spacing: PaneBarLayout.spacing) { subviews }
                                .fixedSize()
                        }
                        .frame(minHeight: MacStyle.paneControlHeight)
                        .controlSize(.regular)
                        .padding(.horizontal, 16)
                        .padding(.bottom, spacing.stackGap)
                    }
                }
            }
        }
    }

    /// The pane bar's leading views, such as a search field, filling the bar up to the
    /// column's trailing slot, with the controls in the slot, or below the leading views once
    /// the controls overflow it. One layout for both arrangements keeps a search field's
    /// identity, and its focus, as the bar changes width. The last subview is the controls.
    struct PaneBarLayout: Layout {
        static let spacing: CGFloat = 8
        /// The narrowest a leading view gets before it takes the bar's full width.
        static let leadingMinWidth: CGFloat = 140

        /// The trailing slot's width, which the leading views stop short of.
        var slot: CGFloat = 0

        /// A slot that holds `icons` glyph controls.
        static func slotWidth(icons: Int) -> CGFloat {
            guard icons > 0 else { return 0 }
            return CGFloat(icons) * MacStyle.paneIconWidth + CGFloat(icons - 1) * spacing
        }

        func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
            guard let controls = subviews.last else { return .zero }
            let leading = subviews.dropLast()
            let trailing = controls.sizeThatFits(.unspecified)
            let width = proposal.width ?? (trailing.width + Self.spacing + Self.leadingMinWidth)
            guard !leading.isEmpty else { return CGSize(width: width, height: trailing.height) }
            let room = Self.leadingRoom(width: width, slot: slot, trailing: trailing.width, count: leading.count)
            let leadingHeight =
                leading.map { $0.sizeThatFits(ProposedViewSize(width: room.each, height: nil)).height }
                .max() ?? 0
            let height =
                room.sharesLine
                ? max(leadingHeight, trailing.height) : leadingHeight + Self.spacing + trailing.height
            return CGSize(width: width, height: height)
        }

        func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
            guard let controls = subviews.last else { return }
            let leading = subviews.dropLast()
            let trailing = controls.sizeThatFits(.unspecified)
            guard !leading.isEmpty else {
                controls.place(at: CGPoint(x: bounds.maxX, y: bounds.midY), anchor: .trailing, proposal: .unspecified)
                return
            }
            let room = Self.leadingRoom(width: bounds.width, slot: slot, trailing: trailing.width, count: leading.count)
            let each = room.each
            let leadingHeight =
                leading.map { $0.sizeThatFits(ProposedViewSize(width: each, height: nil)).height }
                .max() ?? 0
            let lineMid = room.sharesLine ? bounds.midY : bounds.minY + leadingHeight / 2
            var x = bounds.minX
            for view in leading {
                view.place(
                    at: CGPoint(x: x, y: lineMid), anchor: .leading,
                    proposal: ProposedViewSize(width: each, height: nil))
                x += each + Self.spacing
            }
            let controlsMid = room.sharesLine ? bounds.midY : bounds.maxY - trailing.height / 2
            controls.place(at: CGPoint(x: bounds.maxX, y: controlsMid), anchor: .trailing, proposal: .unspecified)
        }

        /// The width each of `count` leading views takes, and whether they share the controls'
        /// line. Measuring and placing both read it, so a view is measured at the width it gets.
        /// The trailing width only decides the line, never the leading width.
        static func leadingRoom(
            width: CGFloat, slot: CGFloat, trailing: CGFloat, count: Int
        ) -> (each: CGFloat, sharesLine: Bool) {
            let beside = width - slot - spacing
            // Too narrow a bar for the slot: the leading views take it whole, over the controls.
            let room = beside >= leadingMinWidth ? beside : width
            // A half point of slack, so a control measured a hair over its slot keeps the line.
            let sharesLine = trailing == 0 || room + spacing + trailing <= width + 0.5
            return ((room - spacing * CGFloat(count - 1)) / CGFloat(count), sharesLine)
        }
    }

    extension View {
        /// Styles controls as a pane bar's: glass, at the bar's height, a menu without its chevron.
        /// A control shows its glyph with `.labelStyle(.iconOnly)` on its own label, since on a
        /// menu the style would reach the menu's items too.
        func paneControls() -> some View {
            menuIndicator(.hidden)
                .menuStyle(.button)
                .buttonStyle(PaneButtonStyle())
                .controlSize(.regular)
        }
    }

    /// A pane bar's glyph control: a glass capsule at the bar's height, every glyph button the
    /// same width so a row of them reads as one set. Glass is the bar's floating chrome, so a
    /// worded control, such as Edit or Close, and an action that leads a set, such as a list's
    /// Play, take ``MacButtonStyle`` instead.
    struct PaneButtonStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            PaneButtonBody(configuration: configuration)
        }
    }

    private struct PaneButtonBody: View {
        let configuration: ButtonStyle.Configuration

        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(MacStyle.body)
                .imageScale(.large)
                .lineLimit(1)
                .foregroundStyle(Palette.textPrimary.opacity(isEnabled ? 1 : MacButtonStyle.disabledOpacity))
                .padding(.horizontal, 8)
                .frame(minWidth: MacStyle.paneIconWidth)
                .frame(height: MacStyle.paneControlHeight)
                .contentShape(.capsule)
                .macGlass(in: .capsule)
                .opacity(configuration.isPressed ? 0.6 : 1)
        }
    }
#endif
