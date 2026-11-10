import CrosstuneDesign
import CrosstuneStore
import CrosstuneVocabulary
import SwiftUI

/// The words the Name this location sheet shows.
public enum NameLocationText {
    public static let title = "Name this location"
    public static let savedHere = "Saved here"
    public static let nameLabel = "Location name"
    public static let help = "Recordings made here show this name."
}

/// How the Name and Rename sheets end: every way but Escape and Cancel commits a typed name.
enum LocationNameEnd {
    case commit, cancel

    /// The trimmed name an end writes, nil for Escape or Cancel, a blank name, or one that is
    /// `stored` already.
    nonisolated static func result(_ end: Self, draft: String, stored: String?) -> String? {
        let name = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return end == .commit && !name.isEmpty && name != stored ? name : nil
    }
}

/// Names the recording's own point: the saved locations already within 30 m first, so reusing one is
/// one tap, then a Name field that saves a new one. Nothing is written until the location editor closes.
struct NameLocationSheet: View {
    let candidates: [SavedPlace]
    let onPick: (SavedPlace) -> Void
    let onName: (String) -> Void

    @State private var name = ""
    /// Set by Cancel or Escape, so the dismissal that follows commits nothing.
    @State private var cancelled = false
    /// Set once a name or a saved location is handed on, so the dismissal commits no second.
    @State private var handled = false
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    private var isBlank: Bool { name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    #if os(macOS)
        static let macSize = MacSheetSize.fitted(.brief)

        var body: some View {
            MacSheet(
                title: NameLocationText.title, size: Self.macSize,
                cancel: .cancel(TuneFormSheet.cancel, action: cancel),
                primary: .init(ListNameSheet.save, isEnabled: !isBlank, action: save),
                openingFocus: candidates.isEmpty ? .firstField : .anchor
            ) {
                VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                    if !candidates.isEmpty {
                        MacFormSection(NameLocationText.savedHere, card: false) {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(candidates, id: \.id) { place in
                                    Button {
                                        pick(place)
                                    } label: {
                                        LocationRow(name: place.name, address: place.address, isCurrent: false)
                                    }
                                    .buttonStyle(.macRow)
                                }
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        field
                        Text(NameLocationText.help)
                            .font(MacStyle.secondary)
                            .foregroundStyle(Palette.textSecondary)
                    }
                }
            }
            .onAppear { focused = candidates.isEmpty }
            .onDisappear(perform: finish)
            .shellSheet()
        }
    #endif

    private var field: some View {
        TextField(NameLocationText.nameLabel, text: $name, prompt: Text(NameLocationText.nameLabel))
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

    #if os(iOS)
        var body: some View {
            NavigationStack {
                GroupedForm {
                    if !candidates.isEmpty {
                        Section(NameLocationText.savedHere) {
                            ForEach(candidates, id: \.id) { place in
                                Button {
                                    pick(place)
                                } label: {
                                    LocationRow(name: place.name, address: place.address, isCurrent: false)
                                }
                                .foregroundStyle(.textPrimary)
                            }
                        }
                    }
                    Section {
                        field
                    } footer: {
                        Text(NameLocationText.help)
                    }
                }
                .navigationTitle(NameLocationText.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(TuneFormSheet.cancel, action: cancel)
                    }
                    ConfirmToolbarItem {
                        Button(ListNameSheet.save, action: save)
                            .disabled(isBlank)
                    }
                }
                .onAppear { focused = candidates.isEmpty }
                .onDisappear(perform: finish)
            }
            .partHeightSheet()
        }
    #endif

    private func save() {
        guard !isBlank else { return }
        handled = true
        onName(name)
        dismiss()
    }

    private func pick(_ place: SavedPlace) {
        handled = true
        onPick(place)
        dismiss()
    }

    private func cancel() {
        cancelled = true
        dismiss()
    }

    /// Commits a typed name that no button handled: tapping outside or swiping the sheet down.
    private func finish() {
        guard !handled else { return }
        handled = true
        if let typed = LocationNameEnd.result(cancelled ? .cancel : .commit, draft: name, stored: nil) {
            onName(typed)
        }
    }
}
