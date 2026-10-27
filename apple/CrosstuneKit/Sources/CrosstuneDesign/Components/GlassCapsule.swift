import SwiftUI

/// Liquid Glass in a capsule, or a thick material where glass cannot be drawn.
package struct GlassCapsule: ViewModifier {
    package init() {}
    @Environment(\.drawsGlass) private var drawsGlass

    package func body(content: Content) -> some View {
        if drawsGlass {
            content.glassEffect(.regular, in: .capsule)
        } else {
            content
                .background(.thickMaterial, in: .capsule)
                .elevation(.float)
        }
    }
}
