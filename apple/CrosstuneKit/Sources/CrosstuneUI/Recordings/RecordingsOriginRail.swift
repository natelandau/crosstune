import CrosstuneVocabulary
import SwiftUI

/// A rail over the recordings list: All, Mine, then each import source the recordings come from.
struct RecordingsOriginRail: View {
    static let allLabel = "All"
    static let mineLabel = "Mine"
    static let accessibilityLabel = "Recordings by source"

    let choice: String
    /// The import sources to offer, in the order to show them.
    let origins: [String]
    let onChange: (String) -> Void

    static func label(for origin: String) -> String {
        RecordingText.originLabel(origin) ?? mineLabel
    }

    var body: some View {
        Rail(chosen: choice) {
            capsule(RecordingsModel.allChoice, label: Self.allLabel)
            capsule(RecordingText.ownOrigin, label: Self.mineLabel)
            ForEach(origins, id: \.self) { origin in
                capsule(origin, label: Self.label(for: origin))
            }
        }
        .sensoryFeedback(.selection, trigger: choice)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Self.accessibilityLabel)
    }

    private func capsule(_ value: String, label: String) -> some View {
        ChoiceCapsule(chosen: choice == value) {
            onChange(value)
        } label: {
            Text(label)
        }
        .id(value)
    }
}
