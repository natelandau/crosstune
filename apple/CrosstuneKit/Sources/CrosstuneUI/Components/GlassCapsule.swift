import SwiftUI

/// Liquid Glass in a capsule, or a thick material where glass cannot be drawn.
struct GlassCapsule: ViewModifier {
    @Environment(\.drawsGlass) private var drawsGlass

    func body(content: Content) -> some View {
        if drawsGlass {
            content.glassEffect(.regular, in: .capsule)
        } else {
            content
                .background(.thickMaterial, in: .capsule)
                .elevation(.float)
        }
    }
}
