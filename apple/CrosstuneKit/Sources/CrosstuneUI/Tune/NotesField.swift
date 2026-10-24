import CrosstuneVocabulary
import SwiftUI

/// A tune's notes, typed straight into the page. Each change saves as it is typed; the edit is
/// reported once per visit to the field, as it is left or the page goes. While the field or its
/// Done holds focus, a line under it says so and offers Done, a visible way to finish.
struct NotesField: View {
    static let placeholder = "Write a note…"
    static let savesAsYouType = "Saves as you type"
    static let done = "Done"

    let model: TuneModel
    /// The notes as stored.
    let stored: String?

    /// What the field shows: the stored notes, except while being edited, when it keeps what was
    /// typed so a save echoing back never moves the caret.
    @State private var text = ""
    @FocusState private var focus: Focus?
    @State private var session = Session()

    /// The notes' editing session, opened on focus and closed once on blur or as the field
    /// goes, so every session the model hears open it also hears close.
    struct Session {
        private var open = false

        /// The change to report as the field's focus changes, or nil when there is none.
        mutating func focus(_ focused: Bool) -> Bool? {
            guard focused != open else { return nil }
            open = focused
            return focused
        }
    }

    /// Where focus sits while the notes are being edited: the field, or its Done, which keyboard
    /// navigation can reach without ending the edit.
    enum Focus: Hashable {
        case editor, done
    }

    /// Whether the notes are being edited, with focus on the field or on its Done.
    nonisolated static func editing(_ focus: Focus?) -> Bool {
        focus != nil
    }

    private var editing: Bool { Self.editing(focus) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            field
            if editing {
                editingLine
            }
            if let failure = model.failure(at: .notes) {
                FailureText(failure)
            }
        }
    }

    private var field: some View {
        editor
            .characterLimit(Vocabulary.Limits.Tune.notes, text: typed)
            .onAppear { text = stored ?? "" }
            // Unfocused, the field follows the stored notes, saves still landing included.
            .onChange(of: stored) { _, notes in
                if !editing { text = notes ?? "" }
            }
            .onChange(of: editing) { _, isEditing in
                if let began = session.focus(isEditing) { model.noteEditing(began: began) }
            }
            // Leaving the page with the field focused ends the session without a blur.
            .onDisappear {
                if let began = session.focus(false) { model.noteEditing(began: began) }
            }
    }

    private var editingLine: some View {
        HStack(spacing: 8) {
            Text(Self.savesAsYouType)
                .font(PageStyle.secondary)
                .foregroundStyle(.inkTertiary)
            Spacer(minLength: 0)
            Button(Self.done) { focus = nil }
                .focused($focus, equals: .done)
                #if os(macOS)
                    .buttonStyle(MacButtonStyle(.secondary, size: .small))
                #else
                    .buttonStyle(PageControlStyle())
                #endif
        }
    }

    /// Writes each change to the store as it is typed, in the order typed.
    private var typed: Binding<String> {
        Binding {
            text
        } set: { next in
            text = next
            model.writeNotes(next)
        }
    }

    private var editor: some View {
        TextEditor(text: typed)
            .contentMask()
            .focused($focus, equals: .editor)
            .accessibilityLabel(TuneScreen.notesHeader)
            .scrollContentBackground(.hidden)
            .overlay(alignment: .topLeading) {
                if text.isEmpty {
                    Text(Self.placeholder)
                        .foregroundStyle(.inkSecondary)
                        .padding(Self.placeholderInset)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            #if os(macOS)
                // Grows with the notes, so its scroller has nothing to show.
                .scrollIndicators(.never)
                .macTextEditor(minLines: 3)
            #else
                .scrollDisabled(true)
                .frame(minHeight: 96)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Palette.surface, in: .rect(cornerRadius: PageStyle.surfaceRadius))
            #endif
    }

    /// Where the placeholder sits so it starts where typing does, past the editor's own insets.
    #if os(macOS)
        private static let placeholderInset = EdgeInsets(top: 0, leading: 5, bottom: 0, trailing: 0)
    #else
        private static let placeholderInset = EdgeInsets(top: 8, leading: 5, bottom: 0, trailing: 0)
    #endif
}
