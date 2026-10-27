import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneDesign
import SwiftUI

/// One breakdown value: its name and count over a text-colored bar as wide as its share of the
/// largest value. A row that links to the catalog ends in a chevron; the caller makes it a button.
struct ShareBarRow: View {
    /// A share in the quietest text color, since the accent marks only what can be chosen.
    static var barFill: Color { Palette.textTertiary }

    let value: Stats.Value
    let max: Int
    let link: Bool

    var body: some View {
        HStack(spacing: 8) {
            Text(value.value)
                .contentMask()
                .font(PageStyle.body)
                .foregroundStyle(.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(groupedThousands(value.count))
                .font(PageStyle.body)
                .monospacedDigit()
                .foregroundStyle(.textSecondary)
            if link {
                RowChevron()
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 6)
        // Leaves the bar its own strip under the text.
        .padding(.bottom, 14)
        .frame(minHeight: PageStyle.minTarget)
        .background(alignment: .bottomLeading) {
            GeometryReader { proxy in
                Capsule()
                    .fill(Self.barFill)
                    .frame(width: proxy.size.width * Self.share(count: value.count, max: max), height: 4)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 4)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value.value), \(groupedThousands(value.count))")
    }

    /// The bar's fraction of the row: `count` over `max`, within 0 to 1, and 0 when `max` is 0.
    static func share(count: Int, max: Int) -> Double {
        guard max > 0 else { return 0 }
        return Swift.min(1, Swift.max(0, Double(count) / Double(max)))
    }
}

/// The trailing mark on a row that opens something.
struct RowChevron: View {
    var body: some View {
        Image(systemName: "chevron.forward")
            .font(.platform(.footnote).weight(.semibold))
            .foregroundStyle(.textSecondary)
            .accessibilityHidden(true)
    }
}

/// A plain button that dims while pressed, so a row that opens something answers the touch.
struct PressedOpacityStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.6 : 1)
    }
}
