import CrosstuneStore
import SwiftUI

/// Storage used against the quota: the figure over a bar, or the figure alone with no quota.
struct StorageMeter: View {
    let storage: StorageUsage

    @Environment(\.spacing) private var spacing

    var body: some View {
        let text = RecordingText.storageUsed(storage)
        VStack(alignment: .leading, spacing: spacing.stackGap) {
            Text(text)
                .monospacedDigit()
            if storage.quotaBytes > 0 {
                #if os(macOS)
                    MacMeter(fraction: SettingsModel.storageFraction(storage))
                        .accessibilityLabel(SettingsModel.storageUsed)
                        .accessibilityValue(text)
                #else
                    ProgressView(value: SettingsModel.storageFraction(storage))
                        .accessibilityLabel(SettingsModel.storageUsed)
                        .accessibilityValue(text)
                #endif
            }
        }
        .padding(.vertical, spacing(4))
    }
}
