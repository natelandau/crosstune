import CrosstuneDesign
import CrosstuneStore
import Foundation
import SwiftUI

/// An Isolate range's start and end, in whole values.
struct IsolateSpan: Equatable {
    var start: Int
    var end: Int
}

/// How far one arrow press or VoiceOver swipe moves a range's edge, in units: values, or octaves
/// on the log scale. `largeStep` is for Shift with an arrow.
struct IsolateRangeSteps: Equatable {
    let step: Double
    let largeStep: Double

    /// One step up or down, the large step when `large`.
    func delta(up: Bool, large: Bool) -> Double {
        let size = large ? largeStep : step
        return up ? size : -size
    }
}

/// Where an Isolate range may sit. A unit is a value on the linear scale and an octave on the log
/// scale, so a step or a drag covers the same share of the control anywhere along it.
struct IsolateRangeBounds: Equatable {
    enum Scale: Equatable {
        case linear, log
    }

    let min: Int
    let max: Int
    let scale: Scale
    /// The shortest the range gets, in units.
    let minSpan: Double

    func unit(_ value: Int) -> Double {
        unit(Double(value))
    }

    private func unit(_ value: Double) -> Double {
        scale == .log ? log2(value) : value
    }

    private func value(_ unit: Double) -> Double {
        scale == .log ? pow(2, unit) : unit
    }

    private func tooShort(_ from: Int, _ to: Int) -> Bool {
        unit(to) - unit(from) < minSpan - 1e-9
    }

    /// The range with `edge` moved to `unit`, held inside the bounds and the shortest span from
    /// the other edge.
    func placing(_ edge: LoopModel.Edge, at unit: Double, start: Int, end: Int) -> IsolateSpan {
        // A whole value can land a fraction inside the shortest span, so it steps one further out.
        switch edge {
        case .start:
            let limit = self.unit(end) - minSpan
            var placed = Int(value(unit.clamped(min: self.unit(min), max: limit)).rounded())
            if tooShort(placed, end) { placed -= 1 }
            return IsolateSpan(start: placed.clamped(min: min, max: end), end: end)
        case .end:
            let limit = self.unit(start) + minSpan
            var placed = Int(value(unit.clamped(min: limit, max: self.unit(max))).rounded())
            if tooShort(start, placed) { placed += 1 }
            return IsolateSpan(start: start, end: placed.clamped(min: start, max: max))
        }
    }

    /// The range moved whole by `delta` units, stopping at either end.
    func shifting(start: Int, end: Int, by delta: Double) -> IsolateSpan {
        let low = unit(start)
        let high = unit(end)
        let by = delta.clamped(min: unit(min) - low, max: unit(max) - high)
        let clamp = { (moved: Double) in Int(value(moved).rounded()).clamped(min: min, max: max) }
        let start = clamp(low + by)
        let end = clamp(high + by)
        // Each edge rounds on its own, so the span can land a fraction short and steps one further out.
        guard tooShort(start, end) else { return IsolateSpan(start: start, end: end) }
        return end < max
            ? IsolateSpan(start: start, end: end + 1) : IsolateSpan(start: Swift.max(start - 1, min), end: end)
    }
}

/// A range on one axis with range handles at its ends: drag an edge to move it, or inside to
/// move both. Each edge is an adjustable element and a keyboard stop the arrows nudge. A faint
/// outline of the audio's level along the axis sits behind, decoration only.
struct IsolateRange: View {
    let label: String
    let startLabel: String
    let endLabel: String
    let bounds: IsolateRangeBounds
    let steps: IsolateRangeSteps
    let start: Int
    let end: Int
    /// One edge's value, in words.
    let valueText: (Int) -> String
    /// Reads the audio's level along the axis at a tick's date, from 0 to 1 in evenly spaced
    /// bins.
    let outline: (Date) -> [Float]?
    /// Whether the outline follows the audio now; otherwise it holds its last levels.
    let isLive: Bool
    /// The VoiceOver actions that move an edge up and down by the large step.
    let largeStepUp: String
    let largeStepDown: String
    let onChange: (_ start: Int, _ end: Int) -> Void

    @State private var outlineCache = IsolateOutlineCache()
    @Environment(\.colorScheme) private var colorScheme

    /// The loop color an isolated range draws in, orange, so it reads as a range over the outline.
    private static let color = 1

    var body: some View {
        // The handles place the range in units from the lowest value, so it starts at 0.
        let low = bounds.unit(bounds.min)
        let length = bounds.unit(bounds.max) - low
        let startUnits = bounds.unit(start) - low
        let endUnits = bounds.unit(end) - low
        let text = { (units: Double) in valueText(units == startUnits ? start : end) }
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .leading) {
                if !RangeHandles.drawsWash {
                    Rectangle()
                        .fill(Palette.loopTint(Self.color, scheme: colorScheme))
                        .frame(width: max(0, x(endUnits, length, width) - x(startUnits, length, width)))
                        .offset(x: x(startUnits, length, width))
                        .allowsHitTesting(false)
                }
                TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !isLive)) { context in
                    IsolateOutline(levels: outlineCache.levels(outline(context.date), isLive: isLive))
                        .fill(Palette.borderStrong)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                RangeHandles(
                    start: startUnits, end: endUnits, duration: length,
                    color: Palette.loop(Self.color, scheme: colorScheme),
                    wash: Palette.loopTint(Self.color, scheme: colorScheme),
                    scale: { x($0, length, width) },
                    time: { width > 0 ? Double($0 / width) * length : 0 },
                    snapPoints: [], playhead: nil, minimumLength: bounds.minSpan, movesSpan: true,
                    macFocus: .ring, startLabel: startLabel, endLabel: endLabel,
                    steps: RangeHandles.Steps(
                        nudge: steps.step, largeNudge: steps.largeStep, largerName: largeStepUp,
                        smallerName: largeStepDown),
                    valueText: text, bubbleText: text,
                    onChange: { newStart, newEnd in
                        move(from: (startUnits, endUnits), to: (newStart, newEnd), low: low)
                    },
                    onCommit: { _, _ in }
                )
            }
        }
        // Inset by the grip tabs, which sit outside the range even at either end.
        .padding(.horizontal, RangeHandles.tabWidth)
        .frame(height: PracticeLayout.target)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func x(_ units: Double, _ length: Double, _ width: CGFloat) -> CGFloat {
        length > 0 ? CGFloat(units / length) * width : 0
    }

    /// Places the range where the handles moved it, in whole values: the edge that moved, or
    /// both.
    private func move(from shown: (Double, Double), to moved: (Double, Double), low: Double) {
        let span =
            switch (moved.0 != shown.0, moved.1 != shown.1) {
            case (true, true): bounds.shifting(start: start, end: end, by: moved.0 - shown.0)
            case (true, false): bounds.placing(.start, at: moved.0 + low, start: start, end: end)
            case (false, true): bounds.placing(.end, at: moved.1 + low, start: start, end: end)
            case (false, false): IsolateSpan(start: start, end: end)
            }
        guard span != IsolateSpan(start: start, end: end) else { return }
        onChange(span.start, span.end)
    }
}

/// The outline's levels as last shown. While paused it keeps the last levels that held any sound,
/// since a seek clears the audio's outline; a new recording's screen starts with none.
@MainActor
final class IsolateOutlineCache {
    private var last: [Float] = []

    /// The levels to show for `read`, the audio's outline now.
    func levels(_ read: [Float]?, isLive: Bool) -> [Float] {
        let current = read ?? []
        if current.contains(where: { $0 > 0 }) {
            last = current
            return current
        }
        return isLive ? current : last
    }
}

/// The level in each bin, mirrored about the middle.
private struct IsolateOutline: Shape {
    let levels: [Float]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard !levels.isEmpty else { return path }
        let middle = rect.midY
        let x = { (index: Int) in rect.minX + (CGFloat(index) + 0.5) / CGFloat(levels.count) * rect.width }
        let reach = { (index: Int) in CGFloat(levels[index].clamped(min: 0, max: 1)) * rect.height / 2 }
        path.move(to: CGPoint(x: rect.minX, y: middle))
        for index in levels.indices { path.addLine(to: CGPoint(x: x(index), y: middle - reach(index))) }
        path.addLine(to: CGPoint(x: rect.maxX, y: middle))
        for index in levels.indices.reversed() { path.addLine(to: CGPoint(x: x(index), y: middle + reach(index))) }
        path.closeSubpath()
        return path
    }
}
