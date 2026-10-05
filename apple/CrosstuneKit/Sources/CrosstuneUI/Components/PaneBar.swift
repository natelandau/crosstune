#if os(macOS)
    import SwiftUI

    extension View {
        /// Pins `controls` across the top of this split view column, trailing, as its toolbar.
        /// A Mac toolbar puts a content column's trailing items over the detail column, so a
        /// column's own controls sit here, over the pane they act on.
        func paneBar(@ViewBuilder _ controls: () -> some View) -> some View {
            modifier(PaneBar(leading: EmptyView(), controls: controls()))
        }

        /// ``paneBar(_:)`` with `leading`, such as a search field, taking the room the trailing
        /// controls leave.
        func paneBar(@ViewBuilder leading: () -> some View, @ViewBuilder _ controls: () -> some View) -> some View {
            modifier(PaneBar(leading: leading(), controls: controls()))
        }
    }

    extension EnvironmentValues {
        /// A selection's bulk actions, which take over the pane bar while the selection lasts,
        /// as in Finder and Mail.
        @Entry var paneSelectionControls: AnyView?
    }

    private struct PaneBar<Leading: View, Controls: View>: ViewModifier {
        let leading: Leading
        let controls: Controls

        @Environment(\.spacing) private var spacing
        @Environment(\.paneSelectionControls) private var selectionControls

        func body(content: Content) -> some View {
            content.safeAreaBar(edge: .top) {
                // A bar with nothing in it takes no room, so a screen can stand its controls down.
                // The controls are styled before the split, since a menu reads its indicator from
                // where it resolves. The leading view stays while a selection's actions take the
                // trailing place, so a search still in force stays in sight.
                Group(subviews: leading) { leadingViews in
                    Group(subviews: (selectionControls ?? AnyView(controls)).paneControls()) { subviews in
                        if !subviews.isEmpty || !leadingViews.isEmpty {
                            PaneBarLayout {
                                leadingViews
                                HStack(spacing: PaneBarLayout.spacing) { subviews }
                                    .fixedSize()
                            }
                            .controlSize(.regular)
                            .padding(.horizontal, 16)
                            .padding(.bottom, spacing.stackGap)
                        }
                    }
                }
            }
        }
    }

    /// The pane bar's leading views, such as a search field, beside its trailing controls, or on a
    /// line of their own above them once they would be narrower than ``leadingMinWidth``. One
    /// layout for both arrangements keeps a search field's identity, and its focus, as the bar
    /// changes width. The last subview is the controls.
    private struct PaneBarLayout: Layout {
        static let spacing: CGFloat = 8
        /// The narrowest a leading view gets before it takes a line of its own.
        static let leadingMinWidth: CGFloat = 140

        func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
            guard let controls = subviews.last else { return .zero }
            let leading = subviews.dropLast()
            let trailing = controls.sizeThatFits(.unspecified)
            let width = proposal.width ?? (trailing.width + Self.spacing + Self.leadingMinWidth)
            guard !leading.isEmpty else { return CGSize(width: width, height: trailing.height) }
            let room = leadingRoom(width: width, trailing: trailing.width, count: leading.count)
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
            let room = leadingRoom(width: bounds.width, trailing: trailing.width, count: leading.count)
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
        private func leadingRoom(width: CGFloat, trailing: CGFloat, count: Int) -> (each: CGFloat, sharesLine: Bool) {
            let beside = trailing > 0 ? width - trailing - Self.spacing : width
            let sharesLine = beside >= Self.leadingMinWidth
            let shared = sharesLine ? beside : width
            return ((shared - Self.spacing * CGFloat(count - 1)) / CGFloat(count), sharesLine)
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

    /// A pane bar control: a glass capsule at the bar's height, every glyph button the same
    /// width so a row of them reads as one set.
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
                .foregroundStyle(isEnabled ? AnyShapeStyle(.primary) : AnyShapeStyle(.tertiary))
                .padding(.horizontal, 8)
                .frame(minWidth: MacStyle.paneIconWidth)
                .frame(height: MacStyle.paneControlHeight)
                .contentShape(.capsule)
                .macGlass(in: .capsule)
                .opacity(configuration.isPressed ? 0.6 : 1)
        }
    }
#endif
