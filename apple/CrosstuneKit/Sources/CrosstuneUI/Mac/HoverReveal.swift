#if os(macOS)
    import SwiftUI

    extension EnvironmentValues {
        /// Whether the pointer is over the row a view sits in.
        @Entry var rowHovered = false
    }

    extension View {
        /// Tells the row's ``revealedOnHover(pinned:)`` controls whether the pointer is over it.
        func revealsActionsOnHover() -> some View {
            modifier(RowHover())
        }

        /// A row action that shows while the pointer is over its row, while it has keyboard
        /// focus, or always when `pinned`. Hidden, it keeps its place, its tab stop, and its
        /// spoken name: SwiftUI leaves a fully transparent view out of the Mac accessibility tree,
        /// so it fades to all but invisible rather than out.
        func revealedOnHover(pinned: Bool = false) -> some View {
            modifier(HoverRevealed(pinned: pinned))
        }
    }

    private struct RowHover: ViewModifier {
        @State private var hovering = false

        func body(content: Content) -> some View {
            content
                .onHover { hovering = $0 }
                .environment(\.rowHovered, hovering)
        }
    }

    private struct HoverRevealed: ViewModifier {
        let pinned: Bool

        @Environment(\.rowHovered) private var hovered
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @FocusState private var focused: Bool

        func body(content: Content) -> some View {
            let shows = pinned || hovered || focused
            content
                .focused($focused)
                .opacity(shows ? 1 : 0.001)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: shows)
        }
    }
#endif
