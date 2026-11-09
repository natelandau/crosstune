import SwiftUI

/// A field for text of several lines that grows as it is typed: the filled multiline field on
/// iPhone and iPad, and the Mac's text editor, at least `macMinLines` tall, with its prompt drawn
/// over it while it is empty.
package struct MultilineTextField: View {
    private let title: String
    @Binding private var text: String
    private let prompt: String
    private let macMinLines: Int

    /// - Parameter title: What VoiceOver names the field.
    package init(_ title: String, text: Binding<String>, prompt: String, macMinLines: Int = 3) {
        self.title = title
        _text = text
        self.prompt = prompt
        self.macMinLines = macMinLines
    }

    package var body: some View {
        #if os(macOS)
            TextEditor(text: $text)
                .contentMask()
                .accessibilityLabel(title)
                .scrollContentBackground(.hidden)
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(prompt)
                            .foregroundStyle(.textSecondary)
                            .padding(Self.promptInset)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                // Grows with the text, so its scroller has nothing to show.
                .scrollIndicators(.never)
                .macTextEditor(minLines: macMinLines)
        #else
            TextField(title, text: $text, prompt: Text(prompt), axis: .vertical)
                .contentMask()
                .textFieldStyle(.filledMultiline)
        #endif
    }

    #if os(macOS)
        /// Where the prompt sits so it starts where typing does, past the editor's own insets.
        private static let promptInset = EdgeInsets(top: 0, leading: 5, bottom: 0, trailing: 0)
    #endif
}

#Preview("Multiline text field") {
    @Previewable @State var notes = ""
    MultilineTextField("Notes", text: $notes, prompt: "Write a note")
        .padding()
}
