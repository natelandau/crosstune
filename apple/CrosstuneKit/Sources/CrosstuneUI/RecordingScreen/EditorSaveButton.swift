import CrosstuneCommands
import CrosstuneDesign
import SwiftUI

/// An editor that saves over the recording: Save closes it when nothing changed, or asks before
/// writing.
@MainActor
protocol RecordingEditorSaving: AnyObject, Observable {
    var isConfirming: Bool { get set }
    /// True once an edit from elsewhere has taken the screen away.
    var isStale: Bool { get }
    func pressSave() -> TrimModel.SaveAction
    /// Writes the edit; true when it closed the screen.
    func save() async throws -> Bool
}

extension TrimModel: RecordingEditorSaving {}
extension SplitModel: RecordingEditorSaving {}

/// The trim and split screens' Save: a press closes or asks to confirm, and the confirmed save
/// shows its work in the button.
struct EditorSaveButton<Model: RecordingEditorSaving>: View {
    @Bindable var model: Model
    let isDisabled: Bool
    let confirmTitle: String
    let confirmAction: String
    let confirmMessage: String
    @Binding var failure: String?
    let failureText: (any Error) -> String
    let onLeave: () -> Void
    let onDone: () -> Void

    /// Made on the first confirmed save, so a parent that rebuilds this button makes no runner.
    @State private var saving: WorkRunner?
    @Environment(\.editorSaveShortcut) private var shortcut

    var body: some View {
        let phase = saving?.phase ?? .idle
        Button {
            if model.pressSave() == .close { onLeave() }
        } label: {
            WorkingLabel(phase: phase) { Text(RecordingScreenText.save) }
        }
        .keyboardShortcut(shortcut)
        .disabled(isDisabled)
        .workState(saving)
        .coversShell(model.isConfirming)
        .confirmationDialog(confirmTitle, isPresented: $model.isConfirming, titleVisibility: .visible) {
            Button(confirmAction, role: .destructive) { Task { await save() } }
            Button(RecordingScreenText.cancel, role: .cancel) {}
        } message: {
            Text(confirmMessage)
        }
    }

    private func save() async {
        failure = nil
        let saving = saving ?? WorkRunner()
        self.saving = saving
        do {
            try await saving.run(closesOnSuccess: true) {
                if try await model.save() { onDone() }
            }
        } catch CommandError.recordingNotFound {
            // The recording is gone, and the player and this screen go with it.
        } catch {
            // An edit from elsewhere takes the screen away, saying why, in place of this.
            if !model.isStale { failure = failureText(error) }
        }
    }
}
