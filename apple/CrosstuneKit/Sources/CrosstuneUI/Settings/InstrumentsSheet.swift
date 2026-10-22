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
                InstrumentsChoices(model: model)
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

/// The instrument toggles and their help, as the sheet and the iPhone page both show them.
struct InstrumentsChoices: View {
    let model: SettingsModel

    /// One instrument's toggle, wherever it shows, so each reports the same event.
    static func binding(_ instrument: String, model: SettingsModel) -> Binding<Bool> {
        Binding(get: { model.plays(instrument) }, set: { model.setPlays(instrument, $0) })
    }

    static func label(_ instrument: String) -> String {
        Vocabulary.instrumentLabels[instrument] ?? instrument
    }

    var body: some View {
        Section {
            ForEach(Vocabulary.instruments, id: \.self) { instrument in
                Toggle(Self.label(instrument), isOn: Self.binding(instrument, model: model))
            }
        } header: {
            SettingsHelp(SettingsModel.instrumentsHelp)
        } footer: {
            SettingsFailure(model.instrumentsFailure)
        }
    }
}

/// A settings section's header: its name, when it has one, then its help, which leads the rows
/// so the musician reads what a setting does before choosing.
struct SettingsHelp: View {
    let title: String?
    let help: AttributedString?

    init(_ help: String?, title: String? = nil) {
        self.init(attributed: help.map { AttributedString($0) }, title: title)
    }

    /// Help that carries its own runs, such as a link that follows the sentence.
    init(attributed help: AttributedString?, title: String? = nil) {
        self.help = help
        self.title = title
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let title {
                Text(title)
            }
            if let help {
                #if os(macOS)
                    Text(help)
                        .font(MacStyle.secondary)
                        .foregroundStyle(MacPalette.inkSecondary)
                #else
                    Text(help)
                        .font(.platform(.footnote))
                        .fontWeight(.regular)
                        .foregroundStyle(.secondary)
                        .textCase(nil)
                #endif
            }
        }
    }
}

/// The reason a section's last write failed, in red below its rows.
struct SettingsFailure: View {
    let failure: String?

    init(_ failure: String?) {
        self.failure = failure
    }

    var body: some View {
        if let failure {
            Text(failure).foregroundStyle(.red)
        }
    }
}
