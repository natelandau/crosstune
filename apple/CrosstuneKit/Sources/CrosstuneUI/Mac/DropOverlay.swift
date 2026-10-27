import CrosstuneDesign

#if os(macOS)
    import SwiftUI

    /// The mark a column shows while files are dragged over it: an accent outline inset from the
    /// column's edges and a word on what letting go does.
    public struct DropOverlay: View {
        public static let label = "Drop to import"

        @Environment(\.colorScheme) private var colorScheme

        public init() {}

        public var body: some View {
            let shape = RoundedRectangle(cornerRadius: 10)
            shape
                .fill(Palette.tintSubtle(colorScheme))
                .strokeBorder(Palette.accent, lineWidth: 2)
                .overlay {
                    Label(Self.label, systemImage: "square.and.arrow.down")
                        .font(MacStyle.secondary.weight(.medium))
                        .foregroundStyle(Palette.accent)
                        .padding(.horizontal, 10)
                        .frame(height: MacStyle.smallControlHeight)
                        .background(.regularMaterial, in: .capsule)
                }
                .padding(6)
                .allowsHitTesting(false)
        }
    }
#endif
