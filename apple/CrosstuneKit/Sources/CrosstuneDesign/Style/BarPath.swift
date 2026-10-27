import SwiftUI

/// A waveform's bars, each a center line that `GraphicsContext.fill(_:with:)` draws `width`
/// across with round ends. One path of rounded rectangles comes out wider in patches on the GPU
/// renderer, which merges neighboring bars into darker blocks that move with the zoom; a stroked
/// line keeps every bar its own width.
package struct BarPath {
    package let width: CGFloat
    package private(set) var lines = Path()

    package init(width: CGFloat) {
        self.width = width
    }

    package var isEmpty: Bool { lines.isEmpty }

    /// The area the bars cover, round ends included.
    package var boundingRect: CGRect { lines.boundingRect.insetBy(dx: -width / 2, dy: -width / 2) }

    /// Adds the bar that fills `rect`, which is `width` across, along its longer side. A `rect`
    /// shorter than `width` both ways adds nothing, since its round ends would spill past it.
    package mutating func add(_ rect: CGRect) {
        guard max(rect.width, rect.height) >= width else { return }
        let end = width / 2
        if rect.height >= rect.width {
            lines.move(to: CGPoint(x: rect.midX, y: rect.minY + end))
            lines.addLine(to: CGPoint(x: rect.midX, y: rect.maxY - end))
        } else {
            lines.move(to: CGPoint(x: rect.minX + end, y: rect.midY))
            lines.addLine(to: CGPoint(x: rect.maxX - end, y: rect.midY))
        }
    }
}

extension GraphicsContext {
    package func fill(_ bars: BarPath, with shading: Shading) {
        guard !bars.isEmpty else { return }
        stroke(bars.lines, with: shading, style: StrokeStyle(lineWidth: bars.width, lineCap: .round))
    }
}
