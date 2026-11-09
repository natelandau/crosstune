import CrosstuneAnalytics
import CrosstuneDesign
import SwiftUI

/// Annual or Monthly, each with its price and Annual with its saving: radio buttons on the Mac,
/// two selectable tiles elsewhere, since a system segment holds a word but not a price beside it.
struct PeriodTiles: View {
    let options: [PlanSheet.PeriodOption]
    @Binding var period: PurchasePeriod

    #if !os(macOS)
        @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #endif

    var body: some View {
        #if os(macOS)
            if options.count == 1, let only = options.first {
                // Nothing to choose: the one period reads as text, not a lone radio button.
                LabeledContent(PlanText.billingPeriod) { macLabel(only) }
            } else {
                Picker(PlanText.billingPeriod, selection: $period) {
                    ForEach(options, id: \.period) { option in
                        macLabel(option).tag(option.period)
                    }
                }
                .pickerStyle(.radioGroup)
            }
        #else
            // Side by side, or one above the other at the accessibility text sizes, where two
            // tiles abreast break their words.
            let layout =
                dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
            layout {
                ForEach(options, id: \.period) { option in
                    tile(option, selected: option.period == period)
                }
            }
            // Both tiles take the taller one's height.
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(PlanText.billingPeriod)
        #endif
    }

    #if os(macOS)
        private func macLabel(_ option: PlanSheet.PeriodOption) -> some View {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(option.label)
                    if let badge = option.badge {
                        Badge(badge, kind: .brand)
                    }
                }
                Text(option.price)
                    .monospacedDigit()
                    .foregroundStyle(Palette.textSecondary)
            }
        }
    #else
        private func tile(_ option: PlanSheet.PeriodOption, selected: Bool) -> some View {
            OptionCard(isChosen: selected) {
                period = option.period
            } content: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                        .font(.body)
                        .foregroundStyle(selected ? AnyShapeStyle(Palette.accent) : .textSecondary)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        // The badge shares the label's line, and drops below it rather than cover it.
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                label(option)
                                Spacer(minLength: 0)
                                badge(option)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                label(option)
                                badge(option)
                            }
                        }
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline, spacing: 4) { price(option) }
                            VStack(alignment: .leading, spacing: 0) { price(option) }
                        }
                    }
                }
                // Both cards take the taller one's height, with the content at the top.
                .frame(maxHeight: .infinity, alignment: .topLeading)
            }
        }

        private func label(_ option: PlanSheet.PeriodOption) -> some View {
            Text(option.label)
                .font(.subheadline)
                .foregroundStyle(.textSecondary)
        }

        @ViewBuilder
        private func badge(_ option: PlanSheet.PeriodOption) -> some View {
            if let badge = option.badge {
                Badge(badge, kind: .brand)
            }
        }

        /// The amount, the largest text on the tile, then its period in the label's weight.
        @ViewBuilder
        private func price(_ option: PlanSheet.PeriodOption) -> some View {
            Text(option.amount)
                .font(.headline)
                .monospacedDigit()
            Text(option.per)
                .font(.subheadline)
                .foregroundStyle(.textSecondary)
        }
    #endif
}
