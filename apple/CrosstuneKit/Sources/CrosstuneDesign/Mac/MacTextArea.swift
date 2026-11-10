#if os(macOS)
    import SwiftUI

    /// Multiline text on the field fill with a placeholder where typing starts.
    package struct MacTextArea: View {
        /// TextEditor's own padding at each end of a line.
        package static let lineFragmentPadding: CGFloat = 5

        private let label: String
        @Binding private var text: String
        private let placeholder: String
        private let minLines: Int
        private let maxLines: Int?

        /// The editor's own size, which its text is measured against.
        @State private var editorSize: CGSize = .zero
        /// Measured when the text or the size changes, never on a render that changes neither.
        @State private var textOverflows = false

        package init(_ label: String, text: Binding<String>, placeholder: String, minLines: Int, maxLines: Int? = nil) {
            self.label = label
            _text = text
            self.placeholder = placeholder
            self.minLines = minLines
            self.maxLines = maxLines
        }

        /// Whether `text` needs more room than `height` at `width`. The editor's scroll view never
        /// hides its scroller on its own, so a legacy scroller would show with nothing to scroll.
        package static func overflows(_ text: String, width: CGFloat, height: CGFloat) -> Bool {
            // A trailing newline starts a line the measure would not count.
            let measured = text.hasSuffix("\n") ? text + " " : text
            let bounds = NSAttributedString(
                string: measured, attributes: [.font: NSFont.systemFont(ofSize: MacStyle.bodySize)]
            )
            .boundingRect(
                with: CGSize(width: max(width - 2 * lineFragmentPadding, 1), height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading])
            let lines = (bounds.height / MacTextEditorBackground.lineHeight).rounded()
            return lines * MacTextEditorBackground.lineHeight > height + 0.5
        }

        private func measure() {
            textOverflows = Self.overflows(text, width: editorSize.width, height: editorSize.height)
        }

        package var body: some View {
            TextEditor(text: $text)
                .contentMask()
                .accessibilityLabel(label)
                .scrollIndicators(textOverflows ? .automatic : .never)
                .onGeometryChange(for: CGSize.self, of: \.size) { size in
                    editorSize = size
                    measure()
                }
                .onChange(of: text) { measure() }
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(placeholder)
                            .font(MacStyle.body)
                            .foregroundStyle(Palette.textSecondary)
                            // TextEditor's own line fragment inset, so the prompt sits where typing
                            // starts.
                            .padding(.leading, Self.lineFragmentPadding)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                // After the placeholder, so the inset moves it with the text.
                .macTextEditor(minLines: minLines, maxLines: maxLines)
        }
    }
#endif
