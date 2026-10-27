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

/// Names the recording's own point: the saved locations already within 30 m first, so reusing one is
/// one tap, then a Name field that saves a new one. Nothing is written until the edit sheet saves.
struct NameLocationSheet: View {
    let candidates: [SavedPlace]
    let onPick: (SavedPlace) -> Void
    let onName: (String) -> Void

    @State private var name = ""
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    private var isBlank: Bool { name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    #if os(macOS)
        static let macSize = MacSheetSize.fitted(.brief)

        var body: some View {
            MacSheet(
                title: NameLocationText.title, size: Self.macSize,
                cancel: .cancel(TuneFormSheet.cancel) { dismiss() },
                primary: .init(ListNameSheet.save, isEnabled: !isBlank, action: save)
            ) {
                VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                    if !candidates.isEmpty {
                        MacFormSection(NameLocationText.savedHere, card: false) {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(candidates, id: \.id) { place in
                                    Button {
                                        onPick(place)
                                        dismiss()
                                    } label: {
                                        LocationRow(name: place.name, address: place.address, isCurrent: false)
                                    }
                                    .buttonStyle(.macPickRow)
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
            .interactiveDismissDisabled(!name.isEmpty)
            .onAppear { focused = candidates.isEmpty }
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
                        field
                    } footer: {
                        Text(NameLocationText.help)
                    }
                }
                .navigationTitle(NameLocationText.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(TuneFormSheet.cancel) { dismiss() }
                    }
                    ConfirmToolbarItem {
                        Button(ListNameSheet.save, action: save)
                            .fontWeight(.semibold)
                            .disabled(isBlank)
                    }
                }
                .interactiveDismissDisabled(!name.isEmpty)
                .onAppear { focused = candidates.isEmpty }
            }
            .partHeightSheet()
        }
    #endif

    private func save() {
        guard !isBlank else { return }
        onName(name)
        dismiss()
    }
}
