import SwiftUI

extension GraphicsContext {
    /// Draws a cut line in `rect` with a clear gap on each side, so it reads over bars of the
    /// same color, as the played bars are.
    func fillCutLine(_ rect: CGRect, with shading: Shading) {
        var gap = self
        gap.blendMode = .clear
        gap.fill(Path(rect.insetBy(dx: -2, dy: 0)), with: shading)
        fill(Path(rect), with: shading)
    }
}
