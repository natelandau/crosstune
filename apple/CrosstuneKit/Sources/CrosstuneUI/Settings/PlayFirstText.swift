import CrosstuneStore
import CrosstuneVocabulary
import SwiftUI

/// Words for the Play first setting.
public enum PlayFirstText {
    public static let label = "Play first"
    public static let help = "Which version plays when a tune has both and none is pinned."
    /// A choice's name in the picker, by its stored value.
    public static let names: [String: String] = [
        UserSettings.playFirstRecordings: "Recordings",
        UserSettings.playFirstAppleMusic: "Apple Music",
    ]
}

/// Which version a list plays first.
struct PlayFirstPicker: View {
    let model: SettingsModel

    var body: some View {
        Picker(PlayFirstText.label, selection: Binding(get: { model.playFirst }, set: { model.setPlayFirst($0) })) {
            ForEach(Vocabulary.playFirsts, id: \.self) { Text(PlayFirstText.names[$0] ?? $0).tag($0) }
        }
    }
}
