#if os(macOS)
    import SwiftUI

    /// A Mac text field: flat on its container's control fill, no border, with the accent ring while
    /// edited, or the danger ring at all times while its value is invalid. A field under a heading
    /// that names it hides its own label with `.labelsHidden()`.
    // SwiftUI builds the body on the main actor, though the requirement does not say so.
    @MainActor package struct MacFieldStyle: @preconcurrency TextFieldStyle {
        package nonisolated static let radius: CGFloat = MacControl.radius
        package nonisolated static let height: CGFloat = MacControl.regularHeight
        package nonisolated static let horizontalInset: CGFloat = 8

        /// The ring a field draws, or nil for none. The error shows even while another control
        /// has focus, so the person can find the field to fix.
        package nonisolated static func ringToken(isInvalid: Bool, isFocused: Bool) -> Palette.Token? {
            if isInvalid { return .danger }
            return isFocused ? MacControl.focusRingToken : nil
        }

        /// A glyph inside the field's leading padding that says what the field takes, such as a
        /// link.
        package var leadingSymbol: String?
        /// Whether the value fails its check. The caller shows the message under the field.
        package var isInvalid: Bool
        /// Whether the field takes several lines (`axis: .vertical`): taller at rest, its text
        /// from the top.
        package var isMultiline: Bool

        package nonisolated init(leadingSymbol: String? = nil, isInvalid: Bool = false, isMultiline: Bool = false) {
            self.leadingSymbol = leadingSymbol
            self.isInvalid = isInvalid
            self.isMultiline = isMultiline
        }

        // periphery:ignore - SwiftUI calls it through the style's underscored requirement
        package func _body(configuration: TextField<_Label>) -> some View {
            MacFieldBody(
                field: configuration, leadingSymbol: leadingSymbol, isInvalid: isInvalid, isMultiline: isMultiline)
        }
    }

    extension TextFieldStyle where Self == MacFieldStyle {
        package static var macField: Self { MacFieldStyle() }

        package static func macField(leadingSymbol: String) -> Self { MacFieldStyle(leadingSymbol: leadingSymbol) }

        package static func macField(isInvalid: Bool) -> Self { MacFieldStyle(isInvalid: isInvalid) }
    }

    extension View {
        /// A field's ring: the danger ring while invalid, else the accent ring while edited.
        fileprivate func macFieldRing(isFocused: Bool, isInvalid: Bool) -> some View {
            let token = MacFieldStyle.ringToken(isInvalid: isInvalid, isFocused: isFocused)
            return macFocusRing(
                token != nil, cornerRadius: MacFieldStyle.radius, isTextField: true,
                token: token ?? MacControl.focusRingToken)
        }
    }

    private struct MacFieldBody<Field: View>: View {
        let field: Field
        let leadingSymbol: String?
        let isInvalid: Bool
        let isMultiline: Bool

        @Environment(\.macContainer) private var container
        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macPreviewFocused) private var previewFocused
        @FocusState private var focused: Bool

        var body: some View {
            HStack(alignment: isMultiline ? .top : .center, spacing: 6) {
                if let leadingSymbol {
                    Image(systemName: leadingSymbol)
                        .font(.system(size: 12))
                        .foregroundStyle(Palette.textSecondary)
                        .accessibilityHidden(true)
                }
                field
                    // Outside a grouped form the field would draw AppKit's bezel inside the fill.
                    .textFieldStyle(.plain)
                    .font(MacStyle.body)
                    .multilineTextAlignment(.leading)
                    .focused($focused)
                    .focusEffectDisabled()
            }
            .padding(.horizontal, isMultiline ? 10 : MacFieldStyle.horizontalInset)
            .padding(.vertical, isMultiline ? 8 : 5)
            .frame(
                minHeight: isMultiline ? MacTextEditorBackground.height(lines: 3) : MacFieldStyle.height,
                alignment: isMultiline ? .topLeading : .center
            )
            .background(container.controlColor, in: .rect(cornerRadius: MacFieldStyle.radius))
            .macControlEdge(container, scheme: scheme, cornerRadius: MacFieldStyle.radius)
            .macFieldRing(isFocused: focused || previewFocused, isInvalid: isInvalid)
            .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
        }
    }

    /// Multiline text on the field fill, with the field's rings and an inset that keeps the text
    /// off the fill's edge.
    package struct MacTextEditorBackground: ViewModifier {
        /// TextEditor pads each line by its own 5pt line fragment, so the sides take less.
        package static let verticalInset: CGFloat = 9
        package static let horizontalInset: CGFloat = 4
        package static let lineHeight: CGFloat = 16

        package let minLines: Int
        package let maxLines: Int?
        package let isInvalid: Bool

        package init(minLines: Int, maxLines: Int?, isInvalid: Bool = false) {
            self.minLines = minLines
            self.maxLines = maxLines
            self.isInvalid = isInvalid
        }

        @Environment(\.macContainer) private var container
        @Environment(\.colorScheme) private var scheme
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.macPreviewFocused) private var previewFocused
        @FocusState private var focused: Bool

        package func body(content: Content) -> some View {
            content
                .font(MacStyle.body)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .focusEffectDisabled()
                .padding(.vertical, Self.verticalInset)
                .padding(.horizontal, Self.horizontalInset)
                .frame(minHeight: Self.height(lines: minLines), maxHeight: maxLines.map(Self.height(lines:)))
                .background(container.controlColor, in: .rect(cornerRadius: MacFieldStyle.radius))
                .macControlEdge(container, scheme: scheme, cornerRadius: MacFieldStyle.radius)
                .macFieldRing(isFocused: focused || previewFocused, isInvalid: isInvalid)
                .opacity(isEnabled ? 1 : MacControl.disabledOpacity)
        }

        package static func height(lines: Int) -> CGFloat {
            CGFloat(lines) * lineHeight + 2 * verticalInset
        }
    }

    extension View {
        /// Draws a `TextEditor` as a Mac multiline field, `minLines` tall and growing to
        /// `maxLines`, or without a cap when that is nil, with the danger ring while `isInvalid`.
        package func macTextEditor(minLines: Int, maxLines: Int? = nil, isInvalid: Bool = false) -> some View {
            modifier(MacTextEditorBackground(minLines: minLines, maxLines: maxLines, isInvalid: isInvalid))
        }
    }
#endif
