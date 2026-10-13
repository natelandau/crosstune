import SwiftUI

extension PlanSheet {
    /// One thing Premium holds, as the member view lists it.
    struct Included: Equatable {
        let title: String
        let detail: String
        /// The SF Symbol beside it.
        let symbol: String
    }

    nonisolated static let included: [Included] = [
        Included(title: PlanText.includedRecord, detail: PlanText.includedRecordDetail, symbol: "record.circle"),
        Included(title: PlanText.includedEveryDevice, detail: PlanText.includedEveryDeviceDetail, symbol: "icloud"),
        Included(
            title: PlanText.includedPractice, detail: PlanText.includedPracticeDetail, symbol: "slider.horizontal.3"),
        Included(title: PlanText.includedScans, detail: PlanText.includedScansDetail, symbol: "doc.richtext"),
    ]
}

/// What Premium includes, under its heading, a row per feature with its symbol and one line.
struct IncludedList: View {
    /// Grows with the text, so the titles stay in one column at large sizes.
    @ScaledMetric(relativeTo: .body) private var tileSide: CGFloat = 32

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(PlanText.included)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(PlanSheet.included.enumerated()), id: \.element.title) { index, feature in
                    if index > 0 {
                        Divider().padding(.leading, tileSide + 28)
                    }
                    row(feature)
                }
            }
            .planCard()
        }
    }

    private func row(_ feature: PlanSheet.Included) -> some View {
        HStack(spacing: 12) {
            FeatureTile(symbol: feature.symbol, side: tileSide, font: .body.weight(.medium))
            VStack(alignment: .leading, spacing: 2) {
                Text(feature.title)
                Text(feature.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}
