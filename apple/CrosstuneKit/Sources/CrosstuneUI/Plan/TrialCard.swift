import SwiftUI

extension PlanSheet {
    /// How much of the trial has passed, from 0 at its start to 1 at its end and after. The
    /// server sets the trial's length and can move its end, so both instants come from the row;
    /// without them, or with an end not after the start, nothing has passed.
    nonisolated static func trialProgress(startsAt: Date?, endsAt: Date?, now: Date) -> Double {
        guard let startsAt, let endsAt else { return 0 }
        let length = endsAt.timeIntervalSince(startsAt)
        guard length > 0 else { return 0 }
        return min(max(now.timeIntervalSince(startsAt) / length, 0), 1)
    }
}

/// A trial's days left, the day it ends, how much of it has passed, and what it holds and keeps,
/// on the slate wash.
struct TrialCard: View {
    /// When the trial began, nil when the plan does not say.
    let startsAt: Date?
    /// When the trial ends, nil when the plan does not say.
    let endsAt: Date?
    /// A fixed instant to count from, nil to follow the clock.
    var now: Date?

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Group {
            if let now {
                content(now)
            } else {
                // Counts days against the clock, so the card follows midnight.
                TimelineView(.everyMinute) { context in content(context.date) }
            }
        }
        .planCard(tinted: true)
    }

    private func content(_ now: Date) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(PlanText.trial)
                .font(.platform(.footnote).weight(.semibold))
                .foregroundStyle(label)
            if let endsAt {
                Text(PlanText.trialDaysLeft(endsAt: endsAt, now: now))
                    .font(.platform(.title).bold())
                    .monospacedDigit()
                // On the last day the headline already says it ends today.
                if PlanText.trialDays(endsAt: endsAt, now: now) > 0 {
                    Text(PlanText.trialEnds(endsAt))
                        .font(.platform(.subheadline))
                        .foregroundStyle(secondary)
                }
                TrialBar(
                    fraction: PlanSheet.trialProgress(startsAt: startsAt, endsAt: endsAt, now: now),
                    value: PlanText.trialLeft(endsAt: endsAt, now: now)
                )
                .padding(.vertical, 8)
            }
            Text(PlanText.trialStorage)
                .font(.platform(.footnote))
                .foregroundStyle(secondary)
            Text(PlanText.trialKeeps)
                .font(.platform(.footnote))
                .foregroundStyle(secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
    }

    /// The card's quiet lines: secondary ink on the Mac's surface card, the wash's own
    /// secondary elsewhere.
    private var secondary: Color {
        #if os(macOS)
            MacPalette.inkSecondary
        #else
            BrandStyle.washSecondary(scheme)
        #endif
    }

    private var label: Color {
        #if os(macOS)
            MacPalette.inkSecondary
        #else
            BrandStyle.setLabel(scheme)
        #endif
    }
}

/// How much of the trial has passed: slate over a stronger wash than the card's, since a system
/// progress bar's gray track all but vanishes on the wash.
private struct TrialBar: View {
    let fraction: Double
    /// What VoiceOver reads: what is left, since a bare percent does not say of what.
    let value: String

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Capsule()
            .fill(track)
            .overlay(alignment: .leading) {
                GeometryReader { proxy in
                    Capsule()
                        .fill(bar)
                        .frame(width: proxy.size.width * fraction)
                }
            }
            .frame(height: 6)
            .accessibilityElement()
            .accessibilityLabel(PlanText.trial)
            .accessibilityValue(value)
    }

    #if os(macOS)
        private var track: Color { MacPalette.field }
        private var bar: Color { MacPalette.ink }
    #else
        private var track: Color { BrandStyle.tintStrong(scheme) }
        private var bar: Color { BrandStyle.accent }
    #endif
}
