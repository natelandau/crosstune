import CrosstuneDesign
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

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextFieldDoneGroup(doneTitle: Self.done, spacing: 6, onEditingChange: editingChanged) { editing in
                field(editing: editing)
            } line: { done in
                editingLine(done)
            }
            if let failure = model.failure(at: .notes) {
                FailureText(failure)
            }
        }
    }

    private func field(editing: Bool) -> some View {
        editor
            .characterLimit(Vocabulary.Limits.Tune.notes, text: typed)
            .onAppear { text = stored ?? "" }
            // Unfocused, the field follows the stored notes, saves still landing included.
            .onChange(of: stored) { _, notes in
                if !editing { text = notes ?? "" }
            }
            // Leaving the page with the field focused ends the session without a blur.
            .onDisappear {
                if let began = session.focus(false) { model.noteEditing(began: began) }
            }
    }

    private func editingChanged(_ isEditing: Bool) {
        if let began = session.focus(isEditing) { model.noteEditing(began: began) }
    }

    private func editingLine(_ done: TextFieldDoneButton) -> some View {
        HStack(spacing: 8) {
            Text(Self.savesAsYouType)
                .font(PageStyle.secondary)
                .foregroundStyle(.textSecondary)
            Spacer(minLength: 0)
            done
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
        MultilineTextField(TuneScreen.notesHeader, text: typed, prompt: Self.placeholder)
    }
}
