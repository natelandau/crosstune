#if os(iOS)
    import SwiftUI

    /// A selection action bar's button or menu: its label in the accent, a destructive one in the
    /// danger color, so it never reads as the others.
    package struct SelectionActionButtonStyle: ButtonStyle {
        package init() {}

        package func makeBody(configuration: Configuration) -> some View {
            SelectionActionButtonBody(configuration: configuration)
        }
    }

    private struct SelectionActionButtonBody: View {
        let configuration: ButtonStyleConfiguration

        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .foregroundStyle(
                    isEnabled
                        ? (configuration.role == .destructive ? Palette.danger : Palette.accent)
                        : Palette.onDisabled
                )
                .opacity(configuration.isPressed ? 0.5 : 1)
        }
    }

    extension ButtonStyle where Self == SelectionActionButtonStyle {
        /// A selection action bar's button or menu.
        package static var selectionAction: Self { SelectionActionButtonStyle() }
    }
#endif
