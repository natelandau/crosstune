import SwiftUI

/// Lays its subviews out left to right, wrapping to a new line when the next one would not fit,
/// each line's items centered on the line. Holds a tune's facets in one wrapping row.
public struct FlowLayout: Layout {
    public var spacing: CGFloat
    public var lineSpacing: CGFloat

    public init(spacing: CGFloat = 8, lineSpacing: CGFloat = 8) {
        self.spacing = spacing
        self.lineSpacing = lineSpacing
    }

    /// Where each item goes, relative to the layout's origin, and the size of the whole.
    /// `maxWidth` nil lays everything on one line. An item wider than `maxWidth` gets a line of
    /// its own.
    public static func arrange(sizes: [CGSize], maxWidth: CGFloat?, spacing: CGFloat, lineSpacing: CGFloat)
        -> (origins: [CGPoint], size: CGSize)
    {
        var lines: [[Int]] = []
        var lineWidth: CGFloat = 0
        for (index, size) in sizes.enumerated() {
            let fits = maxWidth.map { lineWidth + spacing + size.width <= $0 } ?? true
            if let last = lines.indices.last, fits {
                lines[last].append(index)
                lineWidth += spacing + size.width
            } else {
                lines.append([index])
                lineWidth = size.width
            }
        }

        var origins = Array(repeating: CGPoint.zero, count: sizes.count)
        var y: CGFloat = 0
        var width: CGFloat = 0
        for line in lines {
            let height = line.map { sizes[$0].height }.max() ?? 0
            var x: CGFloat = 0
            for index in line {
                origins[index] = CGPoint(x: x, y: y + (height - sizes[index].height) / 2)
                x += sizes[index].width + spacing
            }
            width = max(width, x - spacing)
            y += height + lineSpacing
        }
        return (origins, CGSize(width: width, height: lines.isEmpty ? 0 : y - lineSpacing))
    }

    /// The width placing wraps at: the proposal when there is one, as measuring did, otherwise the
    /// bounds. Never past the bounds, so an infinite proposal or a narrower placement keeps items
    /// inside them.
    public static func wrapWidth(proposal: CGFloat?, bounds: CGFloat) -> CGFloat {
        min(proposal ?? bounds, bounds)
    }

    /// Each item's ideal size, narrowed to `width` so a long one truncates rather than overflowing.
    public static func itemSizes(
        count: Int, width: CGFloat?, measure: (_ index: Int, _ width: CGFloat?) -> CGSize
    ) -> [CGSize] {
        (0..<count).map { index in
            let ideal = measure(index, nil)
            guard let width, ideal.width > width else { return ideal }
            return measure(index, width)
        }
    }

    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        Self.arrange(
            sizes: sizes(subviews, width: proposal.width), maxWidth: proposal.width, spacing: spacing,
            lineSpacing: lineSpacing
        ).size
    }

    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let width = Self.wrapWidth(proposal: proposal.width, bounds: bounds.width)
        let sizes = sizes(subviews, width: width)
        let origins = Self.arrange(sizes: sizes, maxWidth: width, spacing: spacing, lineSpacing: lineSpacing)
            .origins
        for (index, subview) in subviews.enumerated() {
            subview.place(
                at: CGPoint(x: bounds.minX + origins[index].x, y: bounds.minY + origins[index].y),
                proposal: ProposedViewSize(sizes[index]))
        }
    }

    private func sizes(_ subviews: Subviews, width: CGFloat?) -> [CGSize] {
        Self.itemSizes(count: subviews.count, width: width) { index, width in
            subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
        }
    }
}

#Preview("Flow layout") {
    FlowLayout {
        KeyPill("D")
        StatusGlyph("learning").font(.subheadline)
        Text("Reel")
        Text("Old-time")
        Text("4/4")
        Text("Violin: Cross A (AEAE)")
        Text("5-string banjo: Sawmill (gDGCD), capo 2")
    }
    .padding()
    .frame(width: 320)
}
