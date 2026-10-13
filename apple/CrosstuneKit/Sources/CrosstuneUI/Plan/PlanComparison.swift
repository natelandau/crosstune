import SwiftUI

extension PlanSheet {
    /// What one plan holds of a feature.
    enum Cell: Equatable {
        case included
        case excluded
        /// How much of it, such as "1 tune" or "50 MB".
        case value(String)
    }

    /// One row of the comparison.
    struct Feature: Equatable {
        let title: String
        let free: Cell
        let premium: Cell
        /// The SF Symbol beside it, the included list's own where the two overlap.
        let symbol: String
    }

    /// The pricing spec's Free and Premium table, row for row.
    nonisolated static let comparison: [Feature] = [
        Feature(title: PlanText.featureCatalog, free: .included, premium: .included, symbol: "music.note.list"),
        Feature(
            title: PlanText.featureSync, free: .included, premium: .included, symbol: "arrow.triangle.2.circlepath"),
        Feature(title: PlanText.featureRecord, free: .excluded, premium: .included, symbol: "record.circle"),
        Feature(title: PlanText.featurePlay, free: .excluded, premium: .included, symbol: "play"),
        Feature(title: PlanText.featurePractice, free: .excluded, premium: .included, symbol: "slider.horizontal.3"),
        Feature(
            title: PlanText.featureScans, free: .value(PlanText.scansFree), premium: .value(PlanText.scansPremium),
            symbol: "doc.richtext"),
        Feature(
            title: PlanText.featureStorage, free: .value(PlanText.storageFree),
            premium: .value(PlanText.storagePremium), symbol: "icloud"),
    ]
}

/// Free beside Premium, a row per feature. Premium's header is a coral tab over a column in the
/// slate wash a set filter wears, its checks and values in `BrandStyle.premiumInk`. The wash is
/// one band behind every row, so the dividers cross it rather than cut it into blocks.
struct PlanComparison: View {
    /// What VoiceOver reads for a check and a dash.
    nonisolated static let includedLabel = "Included"
    nonisolated static let excludedLabel = "Not included"

    /// The card's edge above the tab, so the tab's rounded top reads as a tab.
    private static let tabInset: CGFloat = 8

    @Environment(\.colorScheme) private var scheme
    /// Grows with the text, so "Every tune" keeps one line at large sizes.
    @ScaledMetric(relativeTo: .subheadline) private var columnWidth: CGFloat = 84
    @ScaledMetric(relativeTo: .subheadline) private var tileSide: CGFloat = 26

    var body: some View {
        VStack(spacing: 0) {
            header
            ForEach(PlanSheet.comparison, id: \.title) { feature in
                Divider()
                row(feature)
            }
        }
        .background(alignment: .trailing) {
            BrandStyle.setFill(scheme)
                .frame(width: columnWidth)
                .padding(.top, Self.tabInset)
        }
        .planCard()
    }

    private var header: some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)
            Text(PlanText.compareFree)
                .foregroundStyle(.secondary)
                .frame(width: columnWidth)
                .padding(.vertical, 6)
            Text(PlanText.comparePremium)
                .foregroundStyle(BrandStyle.onCoral)
                .frame(width: columnWidth)
                .padding(.vertical, 6)
                .background(BrandStyle.coral, in: UnevenRoundedRectangle(topLeadingRadius: 8, topTrailingRadius: 8))
        }
        .font(.footnote.weight(.semibold))
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, Self.tabInset)
        // Each row names its columns for VoiceOver.
        .accessibilityHidden(true)
    }

    private func row(_ feature: PlanSheet.Feature) -> some View {
        HStack(spacing: 0) {
            HStack(spacing: 10) {
                FeatureTile(symbol: feature.symbol, side: tileSide, font: .footnote.weight(.semibold))
                Text(feature.title)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 12)
            .padding(.vertical, 8)
            cell(feature.free, column: PlanText.compareFree, premium: false)
                .frame(width: columnWidth)
                .frame(maxHeight: .infinity)
            cell(feature.premium, column: PlanText.comparePremium, premium: true)
                .frame(width: columnWidth)
                .frame(maxHeight: .infinity)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func cell(_ cell: PlanSheet.Cell, column: String, premium: Bool) -> some View {
        let color = premium ? AnyShapeStyle(BrandStyle.premiumInk(scheme)) : AnyShapeStyle(.secondary)
        // A Free value is text, and the system secondary falls short of 4.5:1 on the card.
        let valueColor = premium ? color : AnyShapeStyle(BrandStyle.washSecondary(scheme))
        switch cell {
        case .included:
            Image(systemName: "checkmark")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(color)
                .accessibilityLabel("\(column), \(Self.includedLabel)")
        case .excluded:
            // Secondary is the faintest label color that keeps a glyph at 3:1 on the card.
            Image(systemName: "minus")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityLabel("\(column), \(Self.excludedLabel)")
        case .value(let amount):
            Text(amount)
                .font(.footnote.weight(premium ? .semibold : .regular))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .multilineTextAlignment(.center)
                .accessibilityLabel("\(column), \(amount)")
        }
    }
}

/// A feature's symbol on a slate-washed tile, as the comparison and the included list draw it.
/// The glyph takes the set filter's label color, which holds 3:1 on the wash in each appearance.
struct FeatureTile: View {
    let symbol: String
    let side: CGFloat
    let font: Font

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Image(systemName: symbol)
            .font(font)
            .foregroundStyle(BrandStyle.setLabel(scheme))
            .frame(width: side, height: side)
            .background(BrandStyle.setFill(scheme), in: RoundedRectangle(cornerRadius: side * 0.25))
            .accessibilityHidden(true)
    }
}

/// The Plan sheet's inset card: the grouped row fill on iPhone and iPad, a form box on the Mac.
/// A tinted card takes the slate wash instead.
private struct PlanCard: ViewModifier {
    let tinted: Bool

    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        #if os(macOS)
            content
                .background(fill, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        #else
            content
                .background(fill)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        #endif
    }

    private var fill: AnyShapeStyle {
        if tinted { return AnyShapeStyle(BrandStyle.setFill(scheme)) }
        #if os(macOS)
            return AnyShapeStyle(.quinary)
        #else
            return AnyShapeStyle(Color(uiColor: .secondarySystemGroupedBackground))
        #endif
    }
}

extension View {
    func planCard(tinted: Bool = false) -> some View {
        modifier(PlanCard(tinted: tinted))
    }

    /// The Plan sheet's ground: the grouped background on iPhone and iPad, as Settings draws
    /// it, so the cards stand out in both appearances. The Mac keeps the sheet's own ground.
    func planGround() -> some View {
        #if os(macOS)
            self
        #else
            background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
        #endif
    }
}
