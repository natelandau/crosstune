import CrosstuneAnalytics
import CrosstuneStore
import SwiftUI
import UniformTypeIdentifiers

/// How much of the account's audio quota is spent.
struct StorageSummary: View {
    let storage: StorageFigures

    @Environment(\.spacing) private var spacing

    var body: some View {
        let text = RecordingText.storageUsed(storage)
        VStack(alignment: .leading, spacing: spacing(6)) {
            Text(text)
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
            ProgressView(value: SettingsModel.storageFraction(storage))
                .accessibilityLabel(SettingsModel.storageUsed)
                .accessibilityValue(text)
        }
        .accessibilityElement(children: .contain)
    }
}
