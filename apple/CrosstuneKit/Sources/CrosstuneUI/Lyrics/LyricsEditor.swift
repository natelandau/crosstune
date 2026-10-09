import CrosstuneVocabulary
import SwiftUI

/// The whole lyrics body, on a page of its own, for the lyrics reader's Edit.
struct LyricsEditor: View {
    @Binding var lyrics: String

    var body: some View {
        TextEditor(text: $lyrics)
            .contentMask()
            .characterLimit(Vocabulary.Limits.Tune.lyrics, text: $lyrics)
            .accessibilityLabel(TuneFieldLabels.lyrics)
            .overlay(alignment: .topLeading) {
                if lyrics.isEmpty {
                    Text(TuneFieldLabels.lyricsPlaceholder)
                        .foregroundStyle(.tertiary)
                        // The text editor's own text inset, so the placeholder sits where typing starts.
                        .padding(.top, 8)
                        .padding(.leading, 5)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal)
            .navigationTitle(TuneFieldLabels.lyrics)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
    }
}
