import CrosstuneAnalytics
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

/// A small neutral capsule of figures, as "75% +2". The Mac dock shows the figures as plain
/// secondary text.
struct SettingsBadgeLabel: View {
    let text: String

    var body: some View {
        #if os(macOS)
            Text(text)
                .font(MacStyle.secondary)
                .monospacedDigit()
                .foregroundStyle(Palette.inkSecondary)
                .frame(minHeight: PlayerBadge.macHeight)
                .fixedSize()
        #else
            Text(text)
                .font(.platform(.caption))
                .monospacedDigit()
                .padding(.horizontal, 8)
                .frame(minHeight: 22)
                .background(.neutralFill, in: .capsule)
                .fixedSize()
        #endif
    }
}

enum PlayerBadge {
    /// A badge's line on the Mac dock.
    static let macHeight: CGFloat = 20
}

/// While a loop repeats: "Repeating B part", which opens the recording's screen, and a Repeat
/// control that deselects the loop.
struct RepeatBadge: View {
    let player: PlayerModel
    let name: String

    /// About a third of an iPhone's bar at the default text size, so a long loop name truncates
    /// rather than pushing the player's own controls out; it grows with the caption it holds.
    @ScaledMetric(relativeTo: .caption) private var maxTextWidth: CGFloat = 120

    @Environment(\.playerWindow) private var window

    var body: some View {
        HStack(spacing: 0) {
            Button {
                if let item = player.item { player.open(item, in: window, source: .dock) }
            } label: {
                #if os(macOS)
                    Text(PracticeText.repeating(name))
                        .contentMask()
                        .font(MacStyle.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: maxTextWidth)
                        .foregroundStyle(Palette.inkSecondary)
                        .frame(minHeight: PlayerBadge.macHeight)
                        .contentShape(.rect)
                #else
                    Text(PracticeText.repeating(name))
                        .contentMask()
                        .font(.platform(.caption))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: maxTextWidth)
                        .onAccentLabel()
                        .padding(.horizontal, 8)
                        .frame(minHeight: 22)
                        .background(Palette.accentFill, in: .capsule)
                        .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                        .contentShape(.rect)
                #endif
            }
            .buttonStyle(.plain)
            Button {
                player.loops.select(nil)
            } label: {
                Label(PracticeText.repeatLoop(name), systemImage: "repeat")
                    .contentMask()
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.tint)
                    .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isSelected)
            .help(PracticeText.repeatLoop(name))
        }
        // The badge keeps its words up to its cap; the item's title beside it truncates first.
        .layoutPriority(1)
    }
}
