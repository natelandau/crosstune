import CrosstuneStore
import CrosstuneVocabulary
import SwiftUI

/// One saved location: its map, a Name field that renames at once, how many recordings use it,
/// and Delete.
struct SavedLocationDetail: View {
    let model: SavedLocationsModel
    let placeID: String

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    /// The name the confirmation was asked for, kept while it fades out.
    @State private var deleteName = ""
    @FocusState private var focused: Bool
    #if os(macOS)
        /// Whether this is the key window; every visible Mac window reads active otherwise.
        @Environment(\.appearsActive) private var appearsActive
    #endif

    private var row: SavedLocationRow? { model.rows?.first { $0.id == placeID } }

    private var asksDelete: Binding<Bool> {
        Binding(
            get: { model.pendingDelete == placeID },
            set: { if !$0 { model.cancelDelete() } })
    }

    var body: some View {
        Form {
            if let row {
                Section {
                    LocationMap(coordinate: Coordinate(lat: row.place.lat, lon: row.place.lon), accuracyM: nil)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(SavedLocationsText.nameLabel, text: $name, prompt: Text(SavedLocationsText.nameLabel))
                        .contentMask()
                        .characterLimit(Vocabulary.Limits.Place.name, text: $name)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { focused = false }
                    if let address = row.place.address {
                        Text(address).foregroundStyle(.secondary).contentMask()
                    }
                    LabeledContent(
                        SettingsModel.recordings, value: SavedLocationsText.recordingsCount(row.recordings))
                } header: {
                    SettingsHelp(SavedLocationsText.nameHelp)
                } footer: {
                    SettingsFailure(model.failure)
                }
                Section {
                    Button(SavedLocationsText.deleteLocation, role: .destructive) {
                        deleteName = row.place.name
                        model.askDelete(placeID)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .overlay {
            if row == nil, model.rows != nil {
                ContentUnavailableView(
                    SavedLocationsText.gone, systemImage: SettingsCategory.savedLocations.systemImage)
            }
        }
        .navigationTitle(row?.place.name ?? SavedLocationsText.title)
        .onAppear {
            model.clearFailure()
            if let row { name = row.place.name }
        }
        // The shown name follows a rename made on another device, unless it is being typed.
        .onChange(of: row?.place.name) { _, stored in
            if !focused, let stored { name = stored }
        }
        .onChange(of: focused) { _, isFocused in
            guard !isFocused, let row else { return }
            Task { await commit(row) }
        }
        // Leaving with the field focused would otherwise lose what was typed.
        .onDisappear(perform: saveTyped)
        #if os(macOS)
            // Closing the Settings window, or moving to another, can skip onDisappear and leaves
            // the field focused, but either resigns key.
            .onChange(of: appearsActive) { _, active in
                if !active { saveTyped() }
            }
        #endif
        .coversShell(asksDelete.wrappedValue)
        .confirmationDialog(
            SavedLocationsText.deleteTitle(deleteName), isPresented: asksDelete, titleVisibility: .visible
        ) {
            Button(SavedLocationsText.delete, role: .destructive) {
                let deleting = model.confirmDelete()
                Task {
                    if await deleting.value { dismiss() }
                }
            }
        } message: {
            Text(SavedLocationsText.deleteMessage)
        }
    }

    /// Saves a typed name that differs from the stored one, as the field is left behind.
    private func saveTyped() {
        guard let row, name != row.place.name else { return }
        let typed = name
        Task { _ = await model.rename(placeID, to: typed) }
    }

    /// Saves the typed name; a refused one puts the stored name back.
    private func commit(_ row: SavedLocationRow) async {
        if await !model.rename(row.id, to: name) { name = row.place.name }
    }
}
