import SwiftUI

extension View {
    /// Liquid Glass behind a page control in `shape`, with the opaque or material fallback when
    /// glass is off. Only the Mac's page controls draw glass.
    @ViewBuilder
    func pageGlass(in shape: some Shape) -> some View {
        #if os(macOS)
            macGlass(in: shape)
        #else
            self
        #endif
    }
}
