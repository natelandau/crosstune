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
                .font(.platform(.footnote))
                .monospacedDigit()
                .foregroundStyle(.inkSecondary)
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
        .accessibilityElement(children: .contain)
    }
}

#if os(macOS)
    /// The Recordings column's foot on the Mac: the storage summary pinned in a surface bar with
    /// a top hairline, so it stays in view however long the list runs.
    struct StorageBar: View {
        let storage: StorageFigures

        var body: some View {
            StorageSummary(storage: storage)
                // The pane bar's inset, so the meter lines up with the column's text.
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(MacPalette.surface)
                .overlay(alignment: .top) {
                    Rectangle().fill(MacPalette.hairline).frame(height: 1)
                }
        }
    }
#endif
