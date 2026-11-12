#if os(iOS)
    import SwiftUI

    /// Done above the keyboard while its field is edited, for a keyboard with no Return that ends
    /// the edit. Only the edited field shows it, so a screen of such fields never shows two, and
    /// a field that offers its own Done skips it.
    struct KeyboardDoneButton: ViewModifier {
        let isShown: Bool

        @Environment(\.fieldOffersDone) private var fieldOffersDone
        @FocusState private var focused: Bool

        func body(content: Content) -> some View {
            if isShown && !fieldOffersDone {
                content
                    .focused($focused)
                    .toolbar {
                        if focused {
                            ToolbarItemGroup(placement: .keyboard) {
                                Spacer()
                                Button("Done") { focused = false }
                            }
                        }
                    }
            } else {
                content
            }
        }
    }

    extension EnvironmentValues {
        /// Whether the field shows a Done of its own while edited, as in a ``TextFieldDoneGroup``.
        @Entry var fieldOffersDone = false
    }
#endif
