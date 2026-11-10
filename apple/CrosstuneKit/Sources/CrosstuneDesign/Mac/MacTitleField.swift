#if os(macOS)
    import SwiftUI

    /// A Mac title field: a name in title type over a hairline, with no fill, so it reads as the
    /// page's title while it takes edits. The hairline turns into the accent line while edited.
    // SwiftUI builds the body on the main actor, though the requirement does not say so.
    @MainActor package struct MacTitleFieldStyle: @preconcurrency TextFieldStyle {
        package nonisolated init() {}

        // periphery:ignore - SwiftUI calls it through the style's underscored requirement
        package func _body(configuration: TextField<_Label>) -> some View {
            MacTitleFieldBody(field: configuration)
        }
    }

    extension TextFieldStyle where Self == MacTitleFieldStyle {
        package static var macTitleField: Self { MacTitleFieldStyle() }
    }

    private struct MacTitleFieldBody<Field: View>: View {
        let field: Field

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macPreviewFocused) private var previewFocused
        @FocusState private var focused: Bool

        var body: some View {
            field
                .textFieldStyle(.plain)
                .font(MacStyle.formTitle)
                .multilineTextAlignment(.leading)
                .focused($focused)
                .focusEffectDisabled()
                .padding(.top, 3)
                .padding(.bottom, 4)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(showsFocus ? Palette.accent : Palette.border)
                        .frame(height: showsFocus ? MacControl.focusRingWidth : 1)
                        .allowsHitTesting(false)
                        .transaction { $0.animation = nil }
                }
                .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
        }

        private var showsFocus: Bool { focused || previewFocused }
    }
#endif
