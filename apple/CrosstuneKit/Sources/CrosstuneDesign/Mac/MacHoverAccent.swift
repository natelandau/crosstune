#if os(macOS)
    import SwiftUI

    /// A link line's text color: secondary at rest, the accent under the pointer, so the accent
    /// stays for what the musician is about to act on. A selected row's lines follow the
    /// selection's secondary text instead, since the accent holds 4.5:1 on neither the emphasized
    /// fill nor the dark gray one.
    package struct MacHoverAccent: ViewModifier {
        @State private var isHovered = false
        @Environment(\.backgroundProminence) private var prominence
        @Environment(\.macRowSelected) private var rowSelected

        nonisolated package static func token(hovered: Bool, emphasized: Bool, rowSelected: Bool) -> Palette.Token {
            if hovered, !emphasized, !rowSelected { return .accent }
            return SecondaryText.token(emphasized: emphasized, rowSelected: rowSelected)
        }

        package func body(content: Content) -> some View {
            content
                .foregroundStyle(
                    Palette.color(
                        Self.token(hovered: isHovered, emphasized: prominence == .increased, rowSelected: rowSelected))
                )
                .onHover { isHovered = $0 }
        }
    }

    extension View {
        /// Colors a link line in a row as ``MacHoverAccent`` says.
        package func macHoverAccent() -> some View {
            modifier(MacHoverAccent())
        }
    }
#endif
