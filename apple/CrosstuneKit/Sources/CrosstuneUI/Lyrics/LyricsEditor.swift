import CrosstuneDesign
import CrosstuneVocabulary
import SwiftUI

/// The whole lyrics body, on a page of its own, for the lyrics reader's Edit.
struct LyricsEditor: View {
    @Binding var lyrics: String

    @FocusState private var focused: Bool

    var body: some View {
        // The field scrolls its own text once it reaches the keyboard, so the cursor stays in
        // view while the lyrics grow; an outer scroll view would leave it under the keyboard.
        VStack(spacing: 0) {
            TextField(
                TuneFieldLabels.lyrics, text: $lyrics, prompt: Text(TuneFieldLabels.lyricsPlaceholder), axis: .vertical
            )
            .contentMask()
            .labelsHidden()
            .characterLimit(Vocabulary.Limits.Tune.lyrics, text: $lyrics)
            .textFieldStyle(.filledMultiline)
            .focused($focused)
            .layoutPriority(1)
            // The page under short lyrics is part of the editor, so a tap there starts typing.
            // It sits below the field, so a tap in the text places the cursor where it lands.
            Color.clear
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect)
                .onTapGesture { focused = true }
                .accessibilityHidden(true)
        }
        .padding(.horizontal)
        .navigationTitle(TuneFieldLabels.lyrics)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
