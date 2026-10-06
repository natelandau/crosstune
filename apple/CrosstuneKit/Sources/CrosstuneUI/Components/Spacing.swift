import SwiftUI

/// The space between things, tuned at the default text size and scaled as body text scales, so
/// the whole layout grows and shrinks with the text size rather than the type alone.
public struct Spacing: Equatable, Sendable {
    /// How far body text has grown or shrunk from the default size.
    public let scale: CGFloat

    public init(_ size: DynamicTypeSize) {
        scale = TextSize.bodyPointSize(size) / TextSize.bodyPointSize(.large)
    }

    /// `base`, a length at the default size, at this size. Half points keep edges crisp on every
    /// screen scale.
    public func callAsFunction(_ base: CGFloat) -> CGFloat {
        (base * scale * 2).rounded() / 2
    }

    /// Above and below a list row's content.
    public var rowInset: CGFloat { self(10) }
    /// Between the lines of one row.
    public var rowLineGap: CGFloat { self(2) }
    /// Between the chips of a rail.
    public var railGap: CGFloat { self(8) }
    /// Above and below a chip's label, inside its fill.
    public var chipVertical: CGFloat { self(6) }
    /// Between items of one group.
    public var stackGap: CGFloat { self(8) }
    /// Between groups.
    public var sectionGap: CGFloat { self(16) }
}

extension EnvironmentValues {
    /// The spacing for the text size in effect.
    public var spacing: Spacing { Spacing(dynamicTypeSize) }
}

/// The smallest tap target, in points, whatever the text size.
let minimumTapTarget: CGFloat = 44

/// A chip's height at the default size. Scaled relative to `.subheadline`, its label's style, it
/// stands in for a chip's height at any size where a container must leave room for the chip's
/// tap target before the chip lays out.
let defaultChipHeight: CGFloat = 32

/// How far a control `visibleHeight` tall reaches past each edge to be `minimum` tall.
func tapOutset(visibleHeight: CGFloat, minimum: CGFloat = minimumTapTarget) -> CGFloat {
    max(0, (minimum - visibleHeight) / 2)
}

extension View {
    /// Makes a control `visibleHeight` tall take taps across `minimum` points without taking that
    /// height in the layout.
    func tapTarget(visibleHeight: CGFloat, minimum: CGFloat = minimumTapTarget) -> some View {
        let outset = tapOutset(visibleHeight: visibleHeight, minimum: minimum)
        return padding(.vertical, outset)
            .contentShape(.rect)
            .padding(.vertical, -outset)
    }

    /// ``tapTarget(visibleHeight:)`` for a control that measures its own height.
    func tapTarget() -> some View {
        modifier(MeasuredTapTarget())
    }

    /// Gives a list row holding chips edge to edge enough room above and below for the chips'
    /// tap targets, which a list cell would otherwise cut off.
    func chipRowInsets() -> some View {
        modifier(ChipRowInsets())
    }

    /// Gives a list row the scaled space above and below its content. The sides stay at the
    /// system's 16 points, which line up with the navigation title.
    func scaledRowInsets() -> some View {
        modifier(ScaledRowInsets())
    }
}

private struct MeasuredTapTarget: ViewModifier {
    @State private var height = minimumTapTarget

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGFloat.self) {
                $0.size.height
            } action: {
                height = $0
            }
            .tapTarget(visibleHeight: height)
    }
}

private struct ChipRowInsets: ViewModifier {
    @ScaledMetric(relativeTo: .subheadline) private var chipHeight = defaultChipHeight

    func body(content: Content) -> some View {
        let outset = tapOutset(visibleHeight: chipHeight)
        content.listRowInsets(EdgeInsets(top: outset, leading: 0, bottom: outset, trailing: 0))
    }
}

private struct ScaledRowInsets: ViewModifier {
    @Environment(\.spacing) private var spacing

    func body(content: Content) -> some View {
        content.listRowInsets(
            EdgeInsets(top: spacing.rowInset, leading: 16, bottom: spacing.rowInset, trailing: 16))
    }
}
