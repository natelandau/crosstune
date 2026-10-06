import CrosstuneCommands
import SwiftUI

/// Tunes added and recordings made per month, as two strips of bars over the same months. A
/// month with nothing keeps its empty slot, so the spacing reads as time.
struct MonthBarsView: View {
    let months: Stats.Months
    var allTime = false

    @Environment(\.spacing) private var spacing
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var shown: [Stats.Month] { allTime && months.hasAllTime ? months.allTime : months.last12 }

    var body: some View {
        VStack(alignment: .leading, spacing: spacing(12)) {
            strip(StatsCopy.tunesAddedLabel, count: \.tunesAdded)
            strip(StatsCopy.recordingsLabel, count: \.recordings)
            if let first = shown.first, let last = shown.last {
                HStack {
                    Text(StatsCopy.monthLabel(first.month))
                    Spacer()
                    Text(StatsCopy.monthLabel(last.month))
                }
                .font(.caption2)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            }
        }
        // Only the All time choice moves the bars; the ones on arrival are already in place.
        .animation(reduceMotion ? nil : .default, value: allTime)
    }

    private func strip(_ label: String, count: KeyPath<Stats.Month, Int>) -> some View {
        let max = Swift.max(1, shown.map { $0[keyPath: count] }.max() ?? 0)
        return VStack(alignment: .leading, spacing: spacing(4)) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            HStack(alignment: .bottom, spacing: 1) {
                ForEach(shown, id: \.month) { month in
                    let n = month[keyPath: count]
                    // The whole slot is the element, so an empty month still reads out.
                    Color.clear
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .overlay(alignment: .bottom) {
                            UnevenRoundedRectangle(topLeadingRadius: 2, topTrailingRadius: 2)
                                .fill(BrandStyle.accent)
                                .frame(height: 64 * CGFloat(n) / CGFloat(max))
                        }
                        .accessibilityElement()
                        .accessibilityLabel(StatsCopy.monthBarLabel(month.month, n))
                }
            }
            .frame(height: 64)
            .overlay(alignment: .bottom) {
                Rectangle().fill(.quaternary).frame(height: 1)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)
        }
    }
}
