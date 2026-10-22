#if os(macOS)
    import SwiftUI

    extension EnvironmentValues {
        /// Whether the pointer is over the row a view sits in.
        @Entry var rowHovered = false
    }

    extension View {
        /// Tells the row's ``ListRowKeySlot`` whether the pointer is over it.
        func revealsActionsOnHover() -> some View {
            modifier(RowHover())
        }
    }

    /// A list row's trailing slot, shared by its key pill and its play control: the key at
    /// rest, and play in its place while the pointer is over the row, while play has keyboard
    /// focus, or always when `pinned`. Hidden, play keeps its place, its tab stop, and its spoken
    /// name: SwiftUI leaves a fully transparent view out of the Mac accessibility tree, so it
    /// fades to all but invisible rather than out. The key is hidden from accessibility, since
    /// the row's own label says it.
    struct ListRowKeySlot<Play: View>: View {
        let key: KeyModeText?
        /// False where play has nothing to show, so the key stays in sight under the pointer.
        let revealsPlay: Bool
        let pinned: Bool
        @ViewBuilder let play: Play

        @Environment(\.rowHovered) private var hovered
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @FocusState private var focused: Bool

        var body: some View {
            let shows = revealsPlay && (pinned || hovered || focused)
            ZStack(alignment: .trailing) {
                if let key {
                    KeyPill(key.key, suffix: key.suffix, size: .compact)
                        .fixedSize()
                        .opacity(shows ? 0 : 1)
                        .accessibilityHidden(true)
                }
                play
                    .focused($focused)
                    .opacity(shows ? 1 : 0.001)
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: shows)
        }
    }

    extension ListRowKeySlot where Play == EmptyView {
        /// Whether play may take the key's place: anything but a row that can do nothing, unless
        /// it is the row now playing.
        nonisolated static func revealsPlay(action: ListRowPlay.Action?, isCurrent: Bool) -> Bool {
            isCurrent || action != .inert
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
#endif
