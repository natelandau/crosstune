import CrosstuneStore
import SwiftUI

/// Storage used against the quota: the figure over a bar.
struct StorageMeter: View {
    let storage: StorageFigures

    @Environment(\.spacing) private var spacing

    var body: some View {
        let text = RecordingText.storageUsed(storage)
        VStack(alignment: .leading, spacing: spacing.stackGap) {
            Text(text)
                .monospacedDigit()
            ProgressView(value: SettingsModel.storageFraction(storage))
                .accessibilityLabel(SettingsModel.storageUsed)
                .accessibilityValue(text)
        }
        .padding(.vertical, spacing(4))
    }
}
