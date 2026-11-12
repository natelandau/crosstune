import SwiftUI

/// A field for text of several lines that grows as it is typed: the filled multiline field on
/// iPhone and iPad, and the Mac's text area, at least `macMinLines` tall.
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
            MacTextArea(title, text: $text, placeholder: prompt, minLines: macMinLines)
        #else
            TextField(title, text: $text, prompt: Text(prompt), axis: .vertical)
                .contentMask()
                .textEntry(.prose)
                .textFieldStyle(.filledMultiline)
        #endif
    }
}

#Preview("Multiline text field") {
    @Previewable @State var notes = ""
    MultilineTextField("Notes", text: $notes, prompt: "Write a note")
        .padding()
}
