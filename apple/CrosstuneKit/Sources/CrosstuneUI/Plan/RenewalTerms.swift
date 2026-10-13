import SwiftUI

/// The disclosures every surface that sells shows by its price: "Renews until you cancel." over
/// the Terms of Use and Privacy Policy links, with `leading` before the links.
struct RenewalTerms<Leading: View>: View {
    let leading: Leading

    init(@ViewBuilder leading: () -> Leading = { EmptyView() }) {
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
            Text(PlanText.renewsUntilCancelled)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(textAlignment)
                .fixedSize(horizontal: false, vertical: true)
            // One dotted line, or a column whenever that line would not fit, so no link truncates.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) { links(dotted: true) }
                    .lineLimit(1)
                VStack(alignment: alignment, spacing: 4) { links(dotted: false) }
            }
            .font(.caption)
        }
    }

    private var hasLeading: Bool { Leading.self != EmptyView.self }

    @ViewBuilder
    private func links(dotted: Bool) -> some View {
        leading
        ForEach(Array(PlanSheet.links.enumerated()), id: \.element.url) { index, link in
            if dotted && (index > 0 || hasLeading) {
                Text(verbatim: "\u{00B7}")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            Link(link.label, destination: link.url)
        }
    }
}
