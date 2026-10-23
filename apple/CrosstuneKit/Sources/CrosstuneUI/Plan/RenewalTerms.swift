import CrosstuneAnalytics
import SwiftUI

/// The disclosures every surface that sells shows by its price: the selected plan's renewal
/// terms over the Terms of Use and Privacy Policy links, with `leading` before the links.
struct RenewalTerms<Leading: View>: View {
    let price: String
    let period: PurchasePeriod
    let leading: Leading

    init(price: String, period: PurchasePeriod, @ViewBuilder leading: () -> Leading = { EmptyView() }) {
        self.price = price
        self.period = period
        self.leading = leading()
    }

    #if os(macOS)
        private let alignment = HorizontalAlignment.leading
        private let textAlignment = TextAlignment.leading
    #else
        private let alignment = HorizontalAlignment.center
        private let textAlignment = TextAlignment.center
    #endif

    var body: some View {
        VStack(alignment: alignment, spacing: 4) {
            Text(PlanText.renewalTerms(price: price, period: period))
                .font(.platform(.footnote))
                .foregroundStyle(Palette.inkSecondary)
                .multilineTextAlignment(textAlignment)
                .fixedSize(horizontal: false, vertical: true)
            // One dotted line, or a column whenever that line would not fit, so no link truncates.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) { links(dotted: true) }
                    .lineLimit(1)
                VStack(alignment: alignment, spacing: 4) { links(dotted: false) }
            }
            .font(.platform(.caption))
        }
    }

    private var hasLeading: Bool { Leading.self != EmptyView.self }

    @ViewBuilder
    private func links(dotted: Bool) -> some View {
        leading
        ForEach(Array(PlanSheet.links.enumerated()), id: \.element.url) { index, link in
            if dotted && (index > 0 || hasLeading) {
                Text(verbatim: "\u{00B7}")
                    .foregroundStyle(Palette.inkSecondary)
                    .accessibilityHidden(true)
            }
            Link(link.label, destination: link.url)
        }
    }
}
