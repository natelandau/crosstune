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
    #if os(macOS)
        @Environment(\.backgroundProminence) private var backgroundProminence
    #endif

    /// `suffix` follows the key, such as a mode abbreviation; the hue still comes from the key
    /// alone. A chosen pill takes its own hue at full strength.
    public init(_ key: String, suffix: String = "", size: Size = .full, chosen: Bool = false) {
        self.key = key.trimmingCharacters(in: .whitespacesAndNewlines)
        self.suffix = suffix
        self.size = size
        isChosen = chosen
    }

    public var body: some View {
        #if os(macOS)
            if !key.isEmpty {
                Text(key + suffix)
                    .monospacedDigit()
                    .fixedSize()
                    .macChip(
                        state: isChosen ? .chosen : .rest, hue: pillColors?.background.color,
                        hueText: pillColors?.text.color, size: size == .full ? .standalone : .row,
                        minWidth: size == .compact ? MacChip.minRowWidth : nil,
                        onSelectedRow: size == .compact && backgroundProminence == .increased)
            }
        #else
            iOSBody
        #endif
    }

    #if !os(macOS)
        @ViewBuilder private var iOSBody: some View {
            if !key.isEmpty {
                ChipLabel(
                    key + suffix, kind: pillColors == nil ? .choice(isChosen: isChosen) : .token,
                    color: pillColors?.background.color, labelColor: pillColors?.text.color,
                    isCompact: size == .compact)
            }
        }
    #endif

    private var pillColors: KeyColor.PillColors? {
        KeyColor.pillColors(key: key, scheme: colorScheme, chosen: isChosen)
    }
}

/// A key as a choice chip in its pill's colors that picks it, and a hovering chip on the Mac.
package struct KeyChipButton: View {
    package let key: String
    package let chosen: Bool
    package let action: () -> Void

    package init(key: String, chosen: Bool, action: @escaping () -> Void) {
        self.key = key
        self.chosen = chosen
        self.action = action
    }

    @Environment(\.colorScheme) private var colorScheme

    package var body: some View {
        let pillColors = KeyColor.pillColors(key: key, scheme: colorScheme, chosen: chosen)
        Chip(
            .choice(isChosen: chosen), color: pillColors?.background.color, labelColor: pillColors?.text.color,
            action: action
        ) { Text(key).monospacedDigit() }
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
