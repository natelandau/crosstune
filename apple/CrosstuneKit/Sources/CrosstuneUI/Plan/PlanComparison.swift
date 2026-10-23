import SwiftUI

extension PlanSheet {
    /// What one plan holds of a feature.
    enum Cell: Equatable {
        case included
        case excluded
        /// How much of it, such as "3 GB".
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
        Feature(title: PlanText.featureScans, free: .excluded, premium: .included, symbol: "doc.richtext"),
        Feature(
            title: PlanText.featureStorage, free: .excluded, premium: .value(PlanText.storagePremium),
            symbol: "icloud"),
    ]
}

/// Free beside Premium, a row per feature. Premium's header is a coral tab over a column in the
/// accent wash a set filter wears, its checks and values in `BrandStyle.premiumInk`; on the Mac,
/// where coral alone marks Premium, the column is a coral wash with its checks and values in ink.
/// The wash is one band behind every row, so the dividers cross it rather than cut it into blocks.
struct PlanComparison: View {
    #if os(macOS)
        nonisolated static let macPremiumWashOpacity = 0.12
    #endif

    /// What VoiceOver reads for a check and a dash.
    nonisolated static let includedLabel = "Included"
    nonisolated static let excludedLabel = "Not included"

    /// The card's edge above the tab, so the tab's rounded top reads as a tab.
    private static let tabInset: CGFloat = 8

    @Environment(\.colorScheme) private var scheme
    /// Grows with the text, so a value keeps one line at large sizes.
    @ScaledMetric(relativeTo: .subheadline) private var columnWidth: CGFloat = 84
    @ScaledMetric(relativeTo: .subheadline) private var tileSide: CGFloat = 26

    var body: some View {
        VStack(spacing: 0) {
            header
            ForEach(PlanSheet.comparison, id: \.title) { feature in
                PlanDivider()
                row(feature)
            }
        }
        .background(alignment: .trailing) {
            premiumWash
                .frame(width: columnWidth)
                .padding(.top, Self.tabInset)
        }
        .planCard()
    }

    private var premiumWash: Color {
        #if os(macOS)
            BrandStyle.coral.opacity(Self.macPremiumWashOpacity)
        #else
            BrandStyle.setFill(scheme)
        #endif
    }

    private var header: some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)
            Text(PlanText.compareFree)
                .foregroundStyle(Palette.inkSecondary)
                .frame(width: columnWidth)
                .padding(.vertical, 6)
            Text(PlanText.comparePremium)
                .foregroundStyle(BrandStyle.onCoral)
                .frame(width: columnWidth)
                .padding(.vertical, 6)
                .background(BrandStyle.coral, in: UnevenRoundedRectangle(topLeadingRadius: 8, topTrailingRadius: 8))
        }
        .font(.platform(.footnote).weight(.semibold))
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, Self.tabInset)
        // Each row names its columns for VoiceOver.
        .accessibilityHidden(true)
    }

    private func row(_ feature: PlanSheet.Feature) -> some View {
        HStack(spacing: 0) {
            HStack(spacing: 10) {
                FeatureTile(symbol: feature.symbol, side: tileSide, font: .platform(.footnote).weight(.semibold))
                Text(feature.title)
                    .font(.platform(.subheadline, mac: .body))
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
        #if os(macOS)
            let color = AnyShapeStyle(premium ? Palette.ink : Palette.inkSecondary)
            let valueColor = color
        #else
            let color = premium ? AnyShapeStyle(BrandStyle.premiumInk(scheme)) : AnyShapeStyle(Palette.inkSecondary)
            let valueColor = color
        #endif
        switch cell {
        case .included:
            Image(systemName: "checkmark")
                .font(.platform(.subheadline).weight(.semibold))
                .foregroundStyle(color)
                .accessibilityLabel("\(column), \(Self.includedLabel)")
        case .excluded:
            Image(systemName: "minus")
                .font(.platform(.subheadline))
                .foregroundStyle(Palette.inkSecondary)
                .accessibilityLabel("\(column), \(Self.excludedLabel)")
        case .value(let amount):
            Text(amount)
                .font(.platform(.footnote).weight(premium ? .semibold : .regular))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .multilineTextAlignment(.center)
                .accessibilityLabel("\(column), \(amount)")
        }
    }
}

/// A feature's symbol on an accent-washed tile, as the comparison and the included list draw it.
/// The glyph takes the set filter's label color, which holds 3:1 on the wash in each appearance.
/// On the Mac the tile is a field with the glyph in secondary ink, since accent never sits on
/// a glyph at rest.
struct FeatureTile: View {
    let symbol: String
    let side: CGFloat
    let font: Font

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        #if os(macOS)
            let (glyph, fill) = (Palette.inkSecondary, Palette.field)
        #else
            let (glyph, fill) = (BrandStyle.setLabel(scheme), BrandStyle.setFill(scheme))
        #endif
        Image(systemName: symbol)
            .font(font)
            .foregroundStyle(glyph)
            .frame(width: side, height: side)
            .background(fill, in: RoundedRectangle(cornerRadius: side * 0.25))
            .accessibilityHidden(true)
    }
}

/// The Plan sheet's inset card: the grouped row fill on iPhone and iPad, where a tinted card
/// takes the accent wash instead; on the Mac every card is `surface` with no stroke.
private struct PlanCard: ViewModifier {
    let tinted: Bool

    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        #if os(macOS)
            content
                .background(Palette.surface, in: .rect(cornerRadius: MacForm.cardRadius))
                .clipShape(.rect(cornerRadius: MacForm.cardRadius))
                .macSurfaceContainer()
        #else
            content
                .background(fill)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        #endif
    }

    #if !os(macOS)
        private var fill: AnyShapeStyle {
            if tinted { return AnyShapeStyle(BrandStyle.setFill(scheme)) }
            return AnyShapeStyle(Palette.groupedCard)
        }
    #endif
}

/// A rule between a plan card's rows: the Mac's hairline, the system divider elsewhere.
struct PlanDivider: View {
    var body: some View {
        #if os(macOS)
            Rectangle().fill(Palette.hairline).frame(height: 1)
        #else
            Divider()
        #endif
    }
}

extension View {
    func planCard(tinted: Bool = false) -> some View {
        modifier(PlanCard(tinted: tinted))
    }

    #if os(macOS)
        /// A row's inset and height in a Mac plan card, as a form card's rows have. A button fits
        /// the row's height, so a Manage… that arrives late never grows a fitted sheet.
        func macPlanRow() -> some View {
            padding(.horizontal, MacForm.rowInset)
                .padding(.vertical, 4)
                .frame(minHeight: MacForm.rowMinHeight)
        }
    #endif

    /// The Plan sheet's ground: the grouped background on iPhone and iPad, as Settings draws
    /// it, so the cards stand out in both appearances. The Mac keeps the sheet's own ground.
    func planGround() -> some View {
        #if os(macOS)
            self
        #else
            background(Palette.groupedPage.ignoresSafeArea())
        #endif
    }
}
