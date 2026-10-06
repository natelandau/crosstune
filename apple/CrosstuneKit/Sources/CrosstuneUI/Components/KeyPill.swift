import SwiftUI

/// A musical key as a colored pill, the same object wherever a key appears.
///
/// The hue comes from the key's pitch class, so two spellings of one pitch look alike. A key
/// this build cannot read keeps the pill with the neutral fill rather than borrowing a hue.
public struct KeyPill: View {
    /// The two sizes a pill comes in.
    public enum Size: Sendable {
        /// Takes taps across 44 points, for a pill the musician presses or reads on its own.
        case full
        /// Sits inside a line of row metadata without setting the line's height.
        case compact
    }

    private let key: String
    private let suffix: String
    private let size: Size
    private let isChosen: Bool

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.spacing) private var spacing
    @ScaledMetric(relativeTo: .footnote) private var compactHeight: CGFloat = 22

    /// `suffix` follows the key, such as a mode abbreviation; the hue still comes from the key
    /// alone. A chosen pill takes its own hue at full strength.
    public init(_ key: String, suffix: String = "", size: Size = .full, chosen: Bool = false) {
        self.key = key.trimmingCharacters(in: .whitespacesAndNewlines)
        self.suffix = suffix
        self.size = size
        isChosen = chosen
    }

    public var body: some View {
        if !key.isEmpty, size == .full {
            label
                .padding(.vertical, spacing.chipVertical)
                .background(fill, in: .capsule)
                .tapTarget()
        } else if !key.isEmpty {
            label
                .frame(minHeight: compactHeight)
                .background(fill, in: .capsule)
        }
    }

    private var label: some View {
        Text(key + suffix)
            .font(size == .full ? .subheadline : .footnote)
            .fontWeight(.medium)
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(ink)
            .padding(.horizontal, spacing(size == .full ? 12 : 8))
    }

    private var swatch: KeyColor.Swatch? {
        KeyColor.pitchClass(key).map { KeyColor.swatch(pitchClass: $0, scheme: colorScheme, chosen: isChosen) }
    }

    private var fill: AnyShapeStyle {
        if let swatch { return AnyShapeStyle(swatch.background.color) }
        if isChosen { return AnyShapeStyle(.tint) }
        return neutralFill(colorScheme)
    }

    private var ink: AnyShapeStyle {
        if let swatch { return AnyShapeStyle(swatch.ink.color) }
        return isChosen ? AnyShapeStyle(BrandStyle.onAccent(colorScheme)) : AnyShapeStyle(.primary)
    }
}

#Preview("Key pills") {
    VStack(alignment: .leading, spacing: 12) {
        FlowLayout {
            ForEach(["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"], id: \.self) { KeyPill($0) }
        }
        FlowLayout {
            KeyPill("D", chosen: true)
            KeyPill("E", suffix: " dor", size: .compact)
            KeyPill("A", suffix: " mix", size: .compact)
            KeyPill("C/G", size: .compact)
            KeyPill("C/G", chosen: true)
        }
    }
    .padding()
}
