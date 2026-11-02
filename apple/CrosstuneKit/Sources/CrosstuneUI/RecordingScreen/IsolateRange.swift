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

/// A range on one axis with a loop edge handle at each end: drag an edge to move it, or inside to
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

    private enum Grab: Equatable {
        case edge(LoopModel.Edge)
        case both
    }

    /// The range as a drag found it, which the drag's whole translation applies to.
    @State private var dragOrigin: IsolateSpan?
    /// Reset however the drag ends, cancelled included.
    @GestureState private var dragging = false
    @FocusState private var focused: LoopModel.Edge?
    @State private var outlineCache = IsolateOutlineCache()

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let band = Swift.max(0, x(end, width) - x(start, width))
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(.neutralFill)
                    .frame(width: band)
                    .contentShape(.rect)
                    .offset(x: x(start, width))
                    .highPriorityGesture(drag(.both, width: width))
                TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !isLive)) { context in
                    IsolateOutline(levels: outlineCache.levels(outline(context.date), isLive: isLive))
                        .fill(Palette.borderStrong)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                handle(.start, width: width, band: band)
                handle(.end, width: width, band: band)
            }
        }
        // Inset by the grip tabs, which sit outside the range even at either end.
        .padding(.horizontal, LoopHandleMark.tabWidth)
        .frame(height: PracticeLayout.target)
        .onChange(of: dragging) { _, isDragging in
            if !isDragging { dragOrigin = nil }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func x(_ value: Int, _ width: CGFloat) -> CGFloat {
        let low = bounds.unit(bounds.min)
        let span = bounds.unit(bounds.max) - low
        return span > 0 ? CGFloat((bounds.unit(value) - low) / span) * width : 0
    }

    /// An edge's mark and its press target. The target reaches past the grip tab on the outer
    /// side, and at most a third of the band on the inner side, so a narrow band keeps its middle
    /// for dragging the whole range.
    private func handle(_ edge: LoopModel.Edge, width: CGFloat, band: CGFloat) -> some View {
        let value = edge == .start ? start : end
        let outer = Swift.max(PracticeLayout.target / 2, LoopHandleMark.tabWidth)
        let inner = Swift.min(PracticeLayout.target / 2, band / 3)
        let side: Alignment = edge == .start ? .leading : .trailing
        return Color.clear
            .frame(width: outer + inner)
            .frame(maxHeight: .infinity)
            .overlay(alignment: side) {
                LoopHandleMark(edge: edge, gripHeight: PracticeLayout.target)
                    .frame(width: 2 * outer)
                    // On the mark, which is centered on the edge, not the uneven press target.
                    #if os(macOS)
                        .macFocusRing(focused == edge, cornerRadius: 4)
                    #endif
                    .allowsHitTesting(false)
            }
            .contentShape(.rect)
            .offset(x: x(value, width) - (edge == .start ? outer : inner))
            .highPriorityGesture(drag(.edge(edge), width: width))
            .focusable()
            .focused($focused, equals: edge)
            #if os(macOS)
                .focusEffectDisabled()
            #endif
            .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
                let up = ![.leftArrow, .downArrow].contains(press.key)
                step(edge, up: up, large: press.modifiers.contains(.shift))
                return .handled
            }
            .accessibilityElement()
            .accessibilityLabel(edge == .start ? startLabel : endLabel)
            .accessibilityValue(valueText(value))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: step(edge, up: true, large: false)
                case .decrement: step(edge, up: false, large: false)
                @unknown default: break
                }
            }
            .accessibilityAction(named: largeStepUp) { step(edge, up: true, large: true) }
            .accessibilityAction(named: largeStepDown) { step(edge, up: false, large: true) }
    }

    private func step(_ edge: LoopModel.Edge, up: Bool, large: Bool) {
        let from = bounds.unit(edge == .start ? start : end)
        change(bounds.placing(edge, at: from + steps.delta(up: up, large: large), start: start, end: end))
    }

    private func drag(_ grab: Grab, width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: LoopModel.dragThreshold)
            .updating($dragging) { _, dragging, _ in dragging = true }
            .onChanged { drag in
                guard width > 0 else { return }
                let origin = dragOrigin ?? IsolateSpan(start: start, end: end)
                dragOrigin = origin
                let delta =
                    Double(drag.translation.width / width) * (bounds.unit(bounds.max) - bounds.unit(bounds.min))
                switch grab {
                case .both:
                    change(bounds.shifting(start: origin.start, end: origin.end, by: delta))
                case .edge(let edge):
                    let from = bounds.unit(edge == .start ? origin.start : origin.end)
                    change(bounds.placing(edge, at: from + delta, start: origin.start, end: origin.end))
                }
            }
    }

    private func change(_ span: IsolateSpan) {
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
