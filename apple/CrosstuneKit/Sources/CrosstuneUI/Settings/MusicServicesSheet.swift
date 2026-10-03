import CrosstuneCommands
import CrosstuneVocabulary
import SwiftUI

/// The services a tune's recording search covers, one toggle each, kept out of the settings
/// form like the instruments. Each toggle saves as it changes.
struct MusicServicesSheet: View {
    let model: SettingsModel

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(searchableProviders, id: \.self) { provider in
                        Toggle(
                            Vocabulary.providerLabels[provider] ?? provider,
                            isOn: Binding(
                                get: { model.searches(provider) }, set: { model.setSearches(provider, $0) }))
                    }
                } footer: {
                    SettingsFooter(help: SettingsModel.musicServicesHelp, failure: model.searchProvidersFailure)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(SettingsModel.musicServices)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(InstrumentsSheet.done) { dismiss() }
                }
            }
        }
        .partHeightSheet()
    }
}
