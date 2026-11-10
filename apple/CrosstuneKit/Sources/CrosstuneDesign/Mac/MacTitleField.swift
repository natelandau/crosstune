#if os(macOS)
    import SwiftUI

    /// A Mac title field: a name in title type over a hairline, with no fill, so it reads as the
    /// title while it takes edits. The hairline turns into the accent line while edited.
    /// `.form` draws a sheet's or a pane's title; `.page` draws a document page's title, so a
    /// rename keeps the type of the heading it covers.
    // SwiftUI builds the body on the main actor, though the requirement does not say so.
    @MainActor package struct MacTitleFieldStyle: @preconcurrency TextFieldStyle {
        package enum Kind: Sendable { case form, page }

        package let kind: Kind

        package nonisolated init(_ kind: Kind = .form) {
            self.kind = kind
        }

        // periphery:ignore - SwiftUI calls it through the style's underscored requirement
        package func _body(configuration: TextField<_Label>) -> some View {
            MacTitleFieldBody(kind: kind, field: configuration)
        }
    }

    extension TextFieldStyle where Self == MacTitleFieldStyle {
        package static var macTitleField: Self { MacTitleFieldStyle() }

        package static func macTitleField(_ kind: MacTitleFieldStyle.Kind) -> Self {
            MacTitleFieldStyle(kind)
        }
    }

    private struct MacTitleFieldBody<Field: View>: View {
        let kind: MacTitleFieldStyle.Kind
        let field: Field

        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macPreviewFocused) private var previewFocused
        @FocusState private var focused: Bool

        var body: some View {
            field
                .textFieldStyle(.plain)
                .font(kind == .page ? MacStyle.pageTitle : MacStyle.formTitle)
                .tracking(kind == .page ? MacStyle.pageTitleTracking : 0)
                .multilineTextAlignment(.leading)
                .focused($focused)
                .focusEffectDisabled()
                // A page title's field lies over the heading it renames, so its text starts where
                // the heading's does.
                .padding(.top, kind == .page ? 0 : 3)
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
