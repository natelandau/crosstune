import SwiftUI

/// The filled field used outside a form: 12pt corners on `field`, body text, 44pt tall, and a
/// 2pt accent ring while it has focus. A vertical-axis field is at least 96pt tall. On the Mac it
/// draws the Mac field.
// SwiftUI builds the body on the main actor, though the requirement does not say so.
@MainActor package struct FilledTextFieldStyle: @preconcurrency TextFieldStyle {
    package nonisolated static let multilineMinHeight: CGFloat = 96

    package let isMultiline: Bool

    package nonisolated init(isMultiline: Bool = false) {
        self.isMultiline = isMultiline
    }

    package func _body(configuration: TextField<Self._Label>) -> some View {
        #if os(macOS)
            configuration.textFieldStyle(MacFieldStyle(isMultiline: isMultiline))
        #else
            FilledTextFieldBody(isMultiline: isMultiline, content: configuration)
        #endif
    }
}

extension TextFieldStyle where Self == FilledTextFieldStyle {
    /// One line, 44pt tall.
    package static var filled: Self { FilledTextFieldStyle() }

    /// For a field with `axis: .vertical`, at least 96pt tall.
    package static var filledMultiline: Self { FilledTextFieldStyle(isMultiline: true) }
}

#if !os(macOS)
    private struct FilledTextFieldBody<Content: View>: View {
        let isMultiline: Bool
        let content: Content

        @FocusState private var isFocused: Bool
        @ScaledMetric(relativeTo: .body) private var lineHeight = ControlMetrics.rowHeight

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: ControlMetrics.containerRadius)
            content
                .font(.body)
                .contentMask()
                .focused($isFocused)
                .padding(.horizontal, 12)
                .padding(.vertical, isMultiline ? 10 : 0)
                .frame(
                    minHeight: isMultiline ? FilledTextFieldStyle.multilineMinHeight : lineHeight,
                    alignment: isMultiline ? .topLeading : .leading
                )
                .background(Palette.field, in: shape)
                .overlay { shape.strokeBorder(Palette.accent, lineWidth: 2).opacity(isFocused ? 1 : 0) }
                .phoneAnimation(Motion.state, value: isFocused)
                .contentShape(shape)
                .onTapGesture { isFocused = true }
                .keyboardFieldArea()
        }
    }
#endif

#Preview("Filled fields") {
    @Previewable @State var name = ""
    @Previewable @State var notes = ""
    VStack {
        TextField("Name", text: $name).contentMask().textEntry(.name).textFieldStyle(.filled)
        TextField("Notes", text: $notes, axis: .vertical)
            .contentMask()
            .textEntry(.prose)
            .textFieldStyle(.filledMultiline)
    }
    .padding()
}
