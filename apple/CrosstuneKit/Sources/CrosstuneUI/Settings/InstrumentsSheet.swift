import CrosstuneVocabulary
import SwiftUI

/// The instruments a musician plays, one toggle each, answered once and kept out of the
/// settings form so seven rows do not take half of it. Each toggle saves as it changes.
struct InstrumentsSheet: View {
    static let done = "Done"

    let model: SettingsModel

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(Vocabulary.instruments, id: \.self) { instrument in
                        Toggle(
                            Vocabulary.instrumentLabels[instrument] ?? instrument,
                            isOn: Binding(get: { model.plays(instrument) }, set: { model.setPlays(instrument, $0) }))
                    }
                } footer: {
                    SettingsFooter(help: SettingsModel.instrumentsHelp, failure: model.instrumentsFailure)
                }
            }
            .formStyle(.grouped)
            .navigationTitle(SettingsModel.instruments)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(Self.done) { dismiss() }
                }
            }
        }
        .partHeightSheet()
    }
}

/// A section's help, replaced in red by the reason its last write failed.
struct SettingsFooter: View {
    let help: String?
    let failure: String?

    var body: some View {
        if let failure {
            Text(failure).foregroundStyle(.red)
        } else if let help {
            Text(help)
        }
    }
}
