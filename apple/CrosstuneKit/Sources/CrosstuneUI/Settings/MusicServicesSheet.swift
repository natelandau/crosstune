import CrosstuneCommands
import CrosstuneVocabulary
import SwiftUI

/// The services a tune's recording search covers, one toggle each, kept out of the settings
/// form like the instruments. Each toggle saves as it changes.
struct MusicServicesSheet: View {
    let model: SettingsModel

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        #if os(macOS)
            MacSheet(
                title: SettingsModel.musicServices, subtitle: SettingsModel.musicServicesHelp, size: .fitted(.standard),
                cancel: nil, primary: .init(InstrumentsSheet.done) { dismiss() }, escape: { dismiss() }
            ) {
                // The sheet's title and subtitle name the group and say what it does.
                MacMusicServicesSection(model: model, showsHeading: false)
            }
            .shellSheet()
        #else
            NavigationStack {
                Form {
                    MusicServicesChoices(model: model)
                }
                .formStyle(.grouped)
                .navigationTitle(SettingsModel.musicServices)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(InstrumentsSheet.done) { dismiss() }
                    }
                }
            }
            .partHeightSheet()
        #endif
    }
}

/// The service toggles and their help, as the sheet and the iPhone page both show them.
struct MusicServicesChoices: View {
    let model: SettingsModel

    /// One service's toggle, wherever it shows, so each reports the same event.
    static func binding(_ provider: String, model: SettingsModel) -> Binding<Bool> {
        Binding(get: { model.searches(provider) }, set: { model.setSearches(provider, $0) })
    }

    static func label(_ provider: String) -> String {
        Vocabulary.providerLabels[provider] ?? provider
    }

    var body: some View {
        Section {
            ForEach(searchableProviders, id: \.self) { provider in
                Toggle(Self.label(provider), isOn: Self.binding(provider, model: model))
            }
        } header: {
            SettingsHelp(SettingsModel.musicServicesHelp)
        } footer: {
            SettingsFailure(model.searchProvidersFailure)
        }
    }
}

#if os(macOS)
    /// The service toggles as a Mac card under their heading, the help under it, as the
    /// Settings window's Tunes tab and the sheet both show them.
    struct MacMusicServicesSection: View {
        let model: SettingsModel
        /// Whether the group's name and help head it; off where a sheet's title and subtitle do.
        var showsHeading = true
        /// Whether a failed save shows here; off while another view showing the same toggles
        /// reports it.
        var showsFailure = true

        var body: some View {
            MacFormSection(
                showsHeading ? SettingsModel.musicServices : nil,
                subtitle: showsHeading ? SettingsModel.musicServicesHelp : nil,
                failure: showsFailure ? model.searchProvidersFailure : nil
            ) {
                ForEach(searchableProviders, id: \.self) { provider in
                    MacSettingsRow(MusicServicesChoices.label(provider)) {
                        MacSettingsSwitch(
                            MusicServicesChoices.label(provider),
                            isOn: MusicServicesChoices.binding(provider, model: model))
                    }
                }
            }
        }
    }
#endif
