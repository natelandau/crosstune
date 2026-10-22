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

/// Names the take's own point: the saved locations already within 30 m first, so reusing one is
/// one tap, then a Name field that saves a new one. Nothing is written until the edit sheet saves.
struct NameLocationSheet: View {
    let candidates: [SavedPlace]
    let onPick: (SavedPlace) -> Void
    let onName: (String) -> Void

    @State private var name = ""
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    private var isBlank: Bool { name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        let typed = $name
        NavigationStack {
            Form {
                if !candidates.isEmpty {
                    Section(NameLocationText.savedHere) {
                        ForEach(candidates, id: \.id) { place in
                            Button {
                                onPick(place)
                                dismiss()
                            } label: {
                                LocationRow(name: place.name, address: place.address, isCurrent: false)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Section {
                    TextField(NameLocationText.nameLabel, text: typed, prompt: Text(NameLocationText.nameLabel))
                        .contentMask()
                        .characterLimit(Vocabulary.Limits.Place.name, text: typed)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit(save)
                } footer: {
                    Text(NameLocationText.help)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(NameLocationText.title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(TuneFormSheet.cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(ListNameSheet.save, action: save)
                        .fontWeight(.semibold)
                        .disabled(isBlank)
                }
            }
            .interactiveDismissDisabled(!name.isEmpty)
            .onAppear { focused = candidates.isEmpty }
        }
        #if os(iOS)
            .partHeightSheet()
        #else
            .macSheetFrame(.form(minHeight: 260))
            .shellSheet()
        #endif
    }

    private func save() {
        guard !isBlank else { return }
        onName(name)
        dismiss()
    }
}
