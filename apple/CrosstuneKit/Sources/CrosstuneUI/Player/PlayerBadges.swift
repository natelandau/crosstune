import CrosstuneAnalytics
import CrosstuneDesign
import SwiftUI

/// A recording's speed and pitch when either is away from its default: "75% +2".
struct SettingsBadge: View {
    let speedPercent: Int
    let pitchCents: Int

    var body: some View {
        if let badge = RecordingScreenText.badge(speedPercent: speedPercent, pitchCents: pitchCents),
            let label = RecordingScreenText.badgeLabel(speedPercent: speedPercent, pitchCents: pitchCents)
        {
            SettingsBadgeLabel(text: badge)
                .accessibilityLabel(label)
        }
    }
}

/// A badge of figures, as "75% +2".
struct SettingsBadgeLabel: View {
    let text: String

    var body: some View {
        Badge(text)
            .fixedSize()
    }
}

/// While a loop repeats: "Repeating B part", which opens the recording's page, and a Repeat
/// control that deselects the loop.
struct RepeatBadge: View {
    let player: PlayerModel
    let name: String

    /// About a third of an iPhone's bar at the default text size, so a long loop name truncates
    /// rather than pushing the player's own controls out; it grows with the caption it holds.
    /// The Mac dock has room for a short name, so it caps wider.
    #if os(macOS)
        private let maxTextWidth: CGFloat = 240
    #else
        @ScaledMetric(relativeTo: .caption) private var maxTextWidth: CGFloat = 120
    #endif

    @Environment(\.openRecordingPage) private var openRecordingPage
    @Environment(\.openTune) private var openTune

    var body: some View {
        HStack(spacing: 0) {
            Chip(.token, action: open) {
                Text(PracticeText.repeating(name))
                    .contentMask()
                    .truncationMode(.tail)
                    .frame(maxWidth: maxTextWidth)
            }
            Button(PracticeText.repeatLoop(name), systemImage: "repeat", action: stopRepeating)
                .contentMask()
                .labelStyle(.iconOnly)
                .buttonStyle(.icon(isOn: true))
                .controlSize(.small)
                .help(PracticeText.repeatLoop(name))
        }
        // The badge keeps its words up to its cap; the item's title beside it truncates first.
        .layoutPriority(1)
    }

    private func open() {
        player.openLoaded(recordingPage: openRecordingPage, tune: openTune, source: .dock)
    }

    private func stopRepeating() {
        player.loops.select(nil)
    }
}
