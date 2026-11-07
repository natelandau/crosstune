import Foundation

/// A distance as the location editor shows it, in the units of the reader's locale: feet under a
/// tenth of a mile, else miles with one decimal; meters under a kilometer, else kilometers with
/// one decimal. Feet and meters round to the nearest 10, and never below 10, so a spot at hand
/// never reads as 0. The same rules as the web client.
struct DistanceText {
    private static let metersPerFoot = 0.3048
    private static let metersPerMile = 1_609.344

    private let isMetric: Bool
    private let wholeNumber: FloatingPointFormatStyle<Double>
    private let oneDecimal: FloatingPointFormatStyle<Double>

    /// Made once for a locale, since its number styles are costly to build for each row.
    init(locale: Locale = .current) {
        isMetric = locale.measurementSystem == .metric
        wholeNumber = .number.precision(.fractionLength(0)).locale(locale)
        oneDecimal = .number.precision(.fractionLength(1)).locale(locale)
    }

    static func format(meters: Double, locale: Locale = .current) -> String {
        DistanceText(locale: locale).format(meters: meters)
    }

    func format(meters: Double) -> String {
        if isMetric {
            let rounded = Self.tens(meters)
            guard rounded >= 1_000 else { return "\(rounded.formatted(wholeNumber)) m" }
            return "\((meters / 1_000).formatted(oneDecimal)) km"
        }
        let miles = meters / Self.metersPerMile
        guard miles >= 0.1 else { return "\(Self.tens(meters / Self.metersPerFoot).formatted(wholeNumber)) ft" }
        return "\(miles.formatted(oneDecimal)) mi"
    }

    private static func tens(_ value: Double) -> Double {
        max(10, (value / 10).rounded() * 10)
    }
}
