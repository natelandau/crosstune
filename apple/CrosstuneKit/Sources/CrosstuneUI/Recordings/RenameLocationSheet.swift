import CrosstuneDesign
import CrosstuneVocabulary
import SwiftUI

/// Renames the saved location the recording is linked to. The rename is written when Save is
/// pressed and reaches every recording linked to it.
struct RenameLocationSheet: View {
    let current: String
    /// Takes the new name; true once it is stored.
    let onRename: (String) async -> Bool

    @State private var name: String
    @State private var isSaving = false
    /// Set by Cancel or Escape, so the dismissal that follows renames nothing.
    @State private var cancelled = false
    /// Set once the rename is stored, so the dismissal that follows writes no second.
    @State private var handled = false
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    init(current: String, onRename: @escaping (String) async -> Bool) {
        self.current = current
        self.onRename = onRename
        _name = State(initialValue: current)
    }

    private var isBlank: Bool { name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var field: some View {
        TextField(
            SavedLocationsText.nameLabel, text: $name, prompt: Text(SavedLocationsText.nameLabel)
        )
        .contentMask()
        #if os(macOS)
            .labelsHidden()
            .textFieldStyle(.macField)
        #endif
        .characterLimit(Vocabulary.Limits.Place.name, text: $name)
        .focused($focused)
        .submitLabel(.done)
        .onSubmit(save)
    }

    #if os(macOS)
        static let macSize = MacSheetSize.fitted(.brief)

        var body: some View {
            MacSheet(
                title: PlaceSearchText.renameThisLocation, size: Self.macSize,
                cancel: .cancel(TuneFormSheet.cancel, isEnabled: !isSaving, action: cancel),
                primary: .init(ListNameSheet.save, isEnabled: !isBlank && !isSaving, action: save)
            ) {
                VStack(alignment: .leading, spacing: 6) {
                    field
                    Text(SavedLocationsText.nameHelp)
                        .font(MacStyle.secondary)
                        .foregroundStyle(Palette.textSecondary)
                }
            }
            .interactiveDismissDisabled(isSaving)
            .onAppear { focused = true }
            .onDisappear(perform: finish)
            .shellSheet()
        }
    #else
        var body: some View {
            NavigationStack {
                GroupedForm {
                    Section {
                        field
                    } footer: {
                        Text(SavedLocationsText.nameHelp)
                    }
                }
                .navigationTitle(PlaceSearchText.renameThisLocation)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(TuneFormSheet.cancel, action: cancel)
                            .disabled(isSaving)
                    }
                    ConfirmToolbarItem {
                        Button(ListNameSheet.save, action: save)
                            .fontWeight(.semibold)
                            .disabled(isBlank || isSaving)
                    }
                }
                .interactiveDismissDisabled(isSaving)
                .onAppear { focused = true }
                .onDisappear(perform: finish)
            }
            .partHeightSheet()
        }
    #endif

    private func save() {
        guard !isBlank, !isSaving else { return }
        isSaving = true
        Task {
            let stored = await onRename(name)
            isSaving = false
            if stored {
                handled = true
                dismiss()
            } else {
                focused = true
            }
        }
    }

    private func cancel() {
        cancelled = true
        dismiss()
    }

    /// Renames for a changed name that Save did not store: tapping outside or swiping the sheet down.
    private func finish() {
        guard !handled, !isSaving else { return }
        handled = true
        guard let typed = LocationNameEnd.result(cancelled ? .cancel : .commit, draft: name, stored: current)
        else { return }
        let onRename = onRename
        Task { _ = await onRename(typed) }
    }
}
