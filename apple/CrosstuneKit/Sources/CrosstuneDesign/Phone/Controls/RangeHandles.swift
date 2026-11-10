import SwiftUI

#if os(iOS)
    import GameController
#elseif os(macOS)
    import AppKit
#endif

/// The start and end of a span over a waveform: a loop, a trim, a cut, or an isolated band.
/// Each edge is a 2 point line with a grip tab outside the span; inside is a wash of the span's
/// color, and outside the waveform dims. Dragging an edge moves it, snapping to `snapPoints` and
/// the playhead; dragging inside the span moves both when `movesSpan`. A held edge lifts and shows
/// its time. Each edge is a keyboard stop and an adjustable element.
///
/// Times are seconds from 0 to `duration`, or any other unit a screen maps the same way; `scale`
/// and `time` convert between a time and an x in this view. The screen owns the span: `onChange`
/// reports each move, and `onCommit` reports where a finished drag, a VoiceOver step, or a run of
/// held arrow keys left it, once the key is let go or focus moves on. A drag the system cancels,
/// or one whose view goes away, reports the span it started with through `onChange` and
/// `onCommit`, so nothing it moved is kept.
///
/// A new span opens from the playhead when the view appears with an `insertionID`, or when
/// `insertionID` changes to a new value. To delete a span, remove the view: it closes to its
/// center and fades as it leaves. Under Reduce Motion both fade in place.
///
/// With `edges: .endOnly` it is one point, such as a cut between two pieces the screen tints
/// itself: the end edge alone, with no wash, dim, or closing motion. `start` and `minimumLength`
/// keep the end that far after `start`, and `duration` is as late as it goes.
///
/// On the Mac it draws the Mac grip, which widens under the pointer, shows the resize pointer,
/// and rings on keyboard focus, with no wash, dim, lift, or time bubble.
package struct RangeHandles: View {
    nonisolated package static let startName = "Start"
    nonisolated package static let endName = "End"
    nonisolated package static let laterBySecond = "Later by 1 second"
    nonisolated package static let earlierBySecond = "Earlier by 1 second"
    /// How near a snap point, in points on screen, a dragged edge settles on it.
    nonisolated package static let snapReach: Double = 8
    /// Whether the span's wash and the dim outside it are drawn here. The Mac draws neither, so
    /// a screen there tints the span itself.
    #if os(macOS)
        nonisolated package static let drawsWash = false
    #else
        nonisolated package static let drawsWash = true
    #endif

    /// How far one arrow press or VoiceOver swipe moves an edge, and the larger step that Shift
    /// with an arrow and the two named VoiceOver actions take.
    package struct Steps: Sendable {
        let nudge: Double
        let largeNudge: Double
        let largerName: String
        let smallerName: String

        package init(nudge: Double, largeNudge: Double, largerName: String, smallerName: String) {
            self.nudge = nudge
            self.largeNudge = largeNudge
            self.largerName = largerName
            self.smallerName = smallerName
        }

        /// A tenth of a second, and a second for the large step.
        nonisolated package static let seconds = Steps(
            nudge: 0.1, largeNudge: 1, largerName: RangeHandles.laterBySecond,
            smallerName: RangeHandles.earlierBySecond)
    }

    /// Which edges show and move.
    package enum Edges {
        case both
        /// The end edge alone, for a single point.
        case endOnly
    }

    package static let tabWidth: CGFloat = 16
    #if os(macOS)
        package static let macGrip = (width: tabWidth, height: CGFloat(28), radius: CGFloat(4))
        static let tabHeight = macGrip.height
    #else
        static let tabHeight: CGFloat = 44
    #endif
    private static let targetWidth: CGFloat = 44
    /// How near the view's side a held finger scrolls the waveform under it.
    private static let edgeScrollZone: Double = 24
    private static let edgeScrollInterval: Duration = .milliseconds(16)
    private static let space = "RangeHandles"

    private let start: Double
    private let end: Double
    private let duration: Double
    private let color: Color
    private let wash: Color
    private let scale: (Double) -> CGFloat
    private let time: (CGFloat) -> Double
    /// Read only while a drag or an opening needs them, so a caller's per-frame state stays out
    /// of this view's redraws.
    private let snapPoints: () -> [Double]
    private let playhead: () -> Double?
    private let minimumLength: Double
    private let movesSpan: Bool
    private let edges: Edges
    private let isEnabled: Bool
    private let isFocusable: Bool
    private let insertionID: AnyHashable?
    private let startLabel: String
    private let endLabel: String
    private let steps: Steps
    private let valueText: (Double) -> String
    private let bubbleText: (Double) -> String
    private let onChange: (_ start: Double, _ end: Double) -> Void
    private let onCommit: (_ start: Double, _ end: Double) -> Void
    private let onKeyStep: ((_ start: Double, _ end: Double) -> Void)?
    private let onEdgeScroll: ((Double) -> Void)?
    private let onTap: ((Double) -> Void)?
    private let onReveal: ((Double) -> Void)?
    private let onFocus: ((Double) -> Void)?

    /// - Parameters:
    ///   - wash: The span's tint, drawn inside it.
    ///   - isFocusable: False for handles that repeat another set's for touch and the pointer
    ///     alone, so each edge is one keyboard stop.
    ///   - playhead: Where a new span opens from, and a snap point; nil for a span with no
    ///     playhead, which opens from its center.
    ///   - insertionID: Set for a span just made, so it opens from the playhead.
    ///   - valueText: An edge's value for VoiceOver, from its time.
    ///   - bubbleText: The value a held edge's bubble shows, from its time.
    ///   - onEdgeScroll: Scrolls the waveform by a depth from -1 (toward the start) to 1 (toward
    ///     the end), every 16 ms while a held edge sits near a side; deeper is faster. Pass it
    ///     only while zoomed.
    ///   - onTap: A tap on an edge's target or the span, at a time, which is a tap on the
    ///     waveform there.
    ///   - onReveal: An edge out of view took keyboard focus, or a key or VoiceOver step moved
    ///     an edge, at its time; the screen scrolls it into view where it needs to.
    ///   - onFocus: An edge took keyboard focus, at its time.
    ///   - onKeyStep: Takes each arrow-key step's move in place of `onChange`, for a screen that
    ///     treats a run of steps apart from a drag.
    package init(
        start: Double, end: Double, duration: Double, color: Color, wash: Color,
        scale: @escaping (Double) -> CGFloat, time: @escaping (CGFloat) -> Double,
        snapPoints: @autoclosure @escaping () -> [Double], playhead: @autoclosure @escaping () -> Double?,
        minimumLength: Double, movesSpan: Bool,
        edges: Edges = .both, isEnabled: Bool = true, isFocusable: Bool = true,
        insertionID: AnyHashable? = nil,
        startLabel: String = RangeHandles.startName, endLabel: String = RangeHandles.endName,
        steps: Steps = .seconds,
        valueText: @escaping (Double) -> String = RangeEdit.bubbleText,
        bubbleText: @escaping (Double) -> String = RangeEdit.bubbleText,
        onEdgeScroll: ((Double) -> Void)? = nil, onTap: ((Double) -> Void)? = nil,
        onReveal: ((Double) -> Void)? = nil, onFocus: ((Double) -> Void)? = nil,
        onKeyStep: ((_ start: Double, _ end: Double) -> Void)? = nil,
        onChange: @escaping (_ start: Double, _ end: Double) -> Void,
        onCommit: @escaping (_ start: Double, _ end: Double) -> Void
    ) {
        self.start = start
        self.end = end
        self.duration = duration
        self.color = color
        self.wash = wash
        self.scale = scale
        self.time = time
        self.snapPoints = snapPoints
        self.playhead = playhead
        self.minimumLength = minimumLength
        self.movesSpan = movesSpan
        self.edges = edges
        self.isEnabled = isEnabled
        self.isFocusable = isFocusable
        self.insertionID = insertionID
        self.startLabel = startLabel
        self.endLabel = endLabel
        self.steps = steps
        self.valueText = valueText
        self.bubbleText = bubbleText
        self.onEdgeScroll = onEdgeScroll
        self.onTap = onTap
        self.onReveal = onReveal
        self.onFocus = onFocus
        self.onKeyStep = onKeyStep
        self.onChange = onChange
        self.onCommit = onCommit
        // A span mounted to open draws its first frame shut at the playhead.
        _opensOnAppear = State(initialValue: insertionID != nil)
        _insertAnchor = State(
            initialValue: RangeEdit.insertAnchor(
                playhead: insertionID == nil ? nil : playhead(), start: start, end: end, duration: duration))
    }

    private enum Part: Hashable {
        case start, end, span
    }

    /// The span as a drag found it, and how far the finger sat from the grabbed edge.
    private struct Grab {
        let part: Part
        let start: Double
        let end: Double
        let offset: CGFloat
    }

    /// How far a new span has opened from the playhead, and how far it has faded in.
    private struct Opening {
        var openness = 1.0
        var opacity = 1.0
    }

    /// The part a drag holds. It resets however the drag ends, cancelled included, so nothing
    /// stays lifted.
    @GestureState private var held: Part?
    @State private var grab: Grab?
    @State private var fingerX: CGFloat?
    @State private var lastSent: (start: Double, end: Double)?
    @State private var snappedTo: Double?
    @State private var startSnaps = 0
    @State private var endSnaps = 0
    @State private var size: CGSize = .zero
    @State private var scrollSteps = 0
    @State private var insertions = 0
    @State private var insertAnchor: Double
    @State private var keySteps = RangeKeySteps()
    @State private var opensOnAppear: Bool
    @FocusState private var focused: Part?
    #if os(macOS)
        @State private var hovered: Part?
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var motion: PhoneMotion { PhoneMotion.resolve(reduceMotion: reduceMotion) }

    package var body: some View {
        KeyframeAnimator(
            initialValue: opensOnAppear ? Opening(openness: 0, opacity: 0) : Opening(), trigger: insertions
        ) { opening in
            RangeClosingReader { closing in strip(opening, closing: closing) }
        } keyframes: { _ in
            KeyframeTrack(\.openness) {
                MoveKeyframe(motion == .full ? 0 : 1)
                SpringKeyframe(1, spring: Motion.springCurve)
            }
            KeyframeTrack(\.opacity) {
                MoveKeyframe(motion == .none ? 1 : 0)
                LinearKeyframe(1, duration: 0.2)
            }
        }
        .allowsHitTesting(isEnabled)
        .opacity(isEnabled ? 1 : ControlMetrics.disabledSurfaceOpacity)
        .coordinateSpace(.named(Self.space))
        .onGeometryChange(for: CGSize.self) {
            $0.size
        } action: {
            size = $0
        }
        .onAppear {
            guard opensOnAppear else { return }
            opensOnAppear = false
            open()
        }
        .onChange(of: insertionID) { _, id in
            if id != nil { open() }
        }
        .onChange(of: held == nil) { _, released in
            // A drag that ends normally has already finished in `onEnded`.
            if released { cancel() }
        }
        .onChange(of: scrollSteps) { _, _ in
            if let fingerX { follow(fingerX) }
        }
        .onChange(of: focused) { _, part in
            commitKeySteps()
            guard let part, part != .span else { return }
            let edge = part == .start ? start : end
            onFocus?(edge)
            let x = scale(edge)
            if x < 0 || x > size.width { onReveal?(edge) }
        }
        .task(id: edgeScrollDepth != 0) {
            guard let onEdgeScroll else { return }
            // Reads the depth each step, so moving deeper speeds up without a restart.
            while !Task.isCancelled {
                let depth = edgeScrollDepth
                guard depth != 0 else { return }
                onEdgeScroll(depth)
                scrollSteps += 1
                do { try await Task.sleep(for: Self.edgeScrollInterval) } catch { return }
            }
        }
        .onDisappear {
            commitKeySteps()
            cancel()
        }
        #if os(iOS)
            .sensoryFeedback(.impact(weight: .light), trigger: startSnaps + endSnaps)
        #elseif os(macOS)
            .sensoryFeedback(.alignment, trigger: startSnaps + endSnaps)
        #endif
        .accessibilityElement(children: .contain)
        .transition(.asymmetric(insertion: .identity, removal: removal))
    }

    // MARK: Drawing

    private var width: CGFloat { size.width }

    private func strip(_ opening: Opening, closing: Double) -> some View {
        let opened = RangeEdit.opening(start: start, end: end, from: insertAnchor, progress: opening.openness)
        let drawn = RangeEdit.closing(start: opened.start, end: opened.end, progress: closing)
        let startX = scale(drawn.start)
        let endX = scale(drawn.end)
        let leading = min(max(startX, 0), width)
        let trailing = min(max(endX, 0), width)
        // A point has no span inside to keep clear, so its target reaches both ways.
        let reach = RangeEdit.handleReach(
            span: edges == .both ? Double(endX - startX) : .infinity, target: Double(Self.targetWidth),
            tabWidth: Double(Self.tabWidth))
        return ZStack(alignment: .leading) {
            #if !os(macOS)
                // Drawing only, so a press outside a handle reaches the waveform under it.
                if edges == .both {
                    ZStack(alignment: .leading) {
                        Rectangle()
                            .fill(Palette.pageBackgroundTranslucent)
                            .frame(width: leading)
                        Rectangle()
                            .fill(Palette.pageBackgroundTranslucent)
                            .frame(width: max(0, width - trailing))
                            .offset(x: trailing)
                        Rectangle()
                            .fill(wash)
                            .frame(width: max(0, trailing - leading))
                            .offset(x: leading)
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            #endif
            if movesSpan {
                Color.clear
                    .frame(width: max(0, trailing - leading))
                    .contentShape(.rect)
                    .offset(x: leading)
                    .gesture(tap, including: onTap == nil ? .none : .all)
                    .highPriorityGesture(drag(.span))
            }
            if edges == .both { handle(.start, x: startX, reach: reach) }
            handle(.end, x: endX, reach: reach)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        // Keyed on the snap, so only a jump onto or off a snap point eases, the handle and the
        // wash together; a drag's own moves stay locked to the finger.
        .phoneAnimation(Motion.spring, reduced: nil, value: snappedTo)
        .opacity(opening.opacity * (1 - closing))
    }

    /// A tap at a time, which is a tap on the waveform under the span or a handle.
    private var tap: some Gesture {
        SpatialTapGesture(coordinateSpace: .named(Self.space)).onEnded { value in
            onTap?(time(value.location.x))
        }
    }

    private func isLifted(_ part: Part) -> Bool {
        held == part || held == .span
    }

    private func isHovered(_ part: Part) -> Bool {
        #if os(macOS)
            hovered == part || held == part
        #else
            false
        #endif
    }

    /// An edge's mark and its press target. The target reaches past the tab on the outer side
    /// and at most a third of the span on the inner side, so a narrow span keeps its middle for
    /// moving the whole span.
    private func handle(_ part: Part, x: CGFloat, reach: (outer: Double, inner: Double)) -> some View {
        let edge = part == .start ? start : end
        let inView = (x >= 0 && x <= width) || held == part
        let outer = CGFloat(reach.outer)
        let inner = CGFloat(reach.inner)
        let isStart = part == .start
        return Color.clear
            .frame(width: outer + inner)
            .frame(maxHeight: .infinity)
            .overlay(alignment: isStart ? .leading : .trailing) {
                HandleMark(
                    isStart: isStart, color: color, tabHeight: min(Self.tabHeight, size.height),
                    isLifted: isLifted(part), isFocused: focused == part, isHovered: isHovered(part),
                    snaps: isStart ? startSnaps : endSnaps, time: edge, bubbleText: bubbleText
                )
                .frame(width: 2 * outer)
                .allowsHitTesting(false)
            }
            .contentShape(.rect)
            .offset(x: min(max(x, 0), width) - (isStart ? outer : inner))
            .opacity(inView ? 1 : 0)
            .allowsHitTesting(inView)
            .gesture(tap, including: onTap == nil ? .none : .all)
            .highPriorityGesture(drag(part))
            #if os(macOS)
                .onHover { inside in
                    if inside { hovered = part } else if hovered == part { hovered = nil }
                }
                .pointerStyle(.columnResize)
                .macFocusable(isEnabled: isEnabled && isFocusable)
                .focused($focused, equals: part)
            #else
                .focusable(isEnabled && isFocusable)
                .focused($focused, equals: part)
                .focusEffectDisabled()
            #endif
            // Held arrows repeat, sweeping the edge as a slider does; letting go commits once.
            .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow], phases: .all) { press in
                guard press.phase != .up else {
                    commitKeySteps()
                    return .handled
                }
                // Command, Option, and Control arrows belong to the menus and the system.
                guard press.modifiers.isDisjoint(with: [.command, .option, .control]) else { return .ignored }
                let later = ![.leftArrow, .downArrow].contains(press.key)
                let amount = press.modifiers.contains(.shift) ? steps.largeNudge : steps.nudge
                step(part, by: later ? amount : -amount, commits: false)
                return .handled
            }
            .accessibilityElement()
            .accessibilityLabel(isStart ? startLabel : endLabel)
            .accessibilityValue(valueText(edge))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: step(part, by: steps.nudge)
                case .decrement: step(part, by: -steps.nudge)
                @unknown default: break
                }
            }
            .accessibilityAction(named: steps.largerName) { step(part, by: steps.largeNudge) }
            .accessibilityAction(named: steps.smallerName) { step(part, by: -steps.largeNudge) }
    }

    // MARK: Motion

    private func open() {
        insertAnchor = RangeEdit.insertAnchor(playhead: playhead(), start: start, end: end, duration: duration)
        insertions += 1
    }

    /// Leaving closes the span to its center under full motion, and fades it otherwise.
    private var removal: AnyTransition {
        guard edges == .both else { return .identity }
        return switch motion {
        case .none: .identity
        case .crossFade: .opacity.animation(Motion.reducedFade)
        case .full: AnyTransition(RangeClosingTransition()).animation(Motion.state)
        }
    }

    // MARK: Dragging

    /// How deep into a side's scroll zone a held finger sits, or 0 when the screen does not
    /// scroll under it.
    private var edgeScrollDepth: Double {
        guard held != nil, onEdgeScroll != nil, let fingerX else { return 0 }
        return RangeEdit.edgeScrollDepth(atX: Double(fingerX), width: Double(width), zone: Self.edgeScrollZone)
    }

    private func drag(_ part: Part) -> some Gesture {
        DragGesture(minimumDistance: ControlMetrics.dragThreshold, coordinateSpace: .named(Self.space))
            .updating($held) { _, held, _ in held = part }
            .onChanged { value in
                if grab == nil {
                    let edge = part == .end ? end : start
                    grab = Grab(part: part, start: start, end: end, offset: value.startLocation.x - scale(edge))
                }
                fingerX = value.location.x
                follow(value.location.x)
            }
            .onEnded { _ in commit() }
    }

    /// Moves the held part under a finger at `x`. Measured from the finger, not the drag's
    /// translation, so the edge stays under it while the waveform scrolls.
    private func follow(_ x: CGFloat) {
        guard let grab else { return }
        let edgeX = x - grab.offset
        let proposed = time(edgeX)
        switch grab.part {
        case .span:
            let moved = RangeEdit.moved(start: grab.start, end: grab.end, by: proposed - grab.start, duration: duration)
            send(moved.start, moved.end, snappedTo: nil, part: .span)
        case .start:
            let target = snapTarget(proposed, at: edgeX)
            let placed = RangeEdit.start(target ?? proposed, end: grab.end, minimumLength: minimumLength)
            send(placed, grab.end, snappedTo: target == placed ? target : nil, part: .start)
        case .end:
            let target = snapTarget(proposed, at: edgeX)
            let placed = RangeEdit.end(
                target ?? proposed, start: grab.start, minimumLength: minimumLength, duration: duration)
            send(grab.start, placed, snappedTo: target == placed ? target : nil, part: .end)
        }
    }

    private func snapTarget(_ proposed: Double, at x: CGFloat) -> Double? {
        guard Snapping.isOn else { return nil }
        let within = abs(time(x + Self.snapReach) - time(x))
        return RangeEdit.snapped(proposed, to: snapPoints() + (playhead().map { [$0] } ?? []), within: within)
    }

    private func send(_ newStart: Double, _ newEnd: Double, snappedTo target: Double?, part: Part) {
        if RangeEdit.enteredSnap(from: snappedTo, to: target) {
            if part == .start { startSnaps += 1 } else { endSnaps += 1 }
        }
        snappedTo = target
        guard lastSent.map({ $0.start != newStart || $0.end != newEnd }) ?? true else { return }
        lastSent = (newStart, newEnd)
        onChange(newStart, newEnd)
    }

    /// A finished drag: the span stays where it left it.
    private func commit() {
        if let lastSent { onCommit(lastSent.start, lastSent.end) }
        reset()
    }

    /// A drag that did not finish: the span goes back to where the drag found it. Does nothing
    /// once the drag has committed.
    private func cancel() {
        if let grab, lastSent != nil {
            onChange(grab.start, grab.end)
            onCommit(grab.start, grab.end)
        }
        reset()
    }

    private func reset() {
        lastSent = nil
        grab = nil
        fingerX = nil
        snappedTo = nil
    }

    /// One step from the keyboard or VoiceOver: a change of its own. A VoiceOver step commits at
    /// once; arrow-key steps commit together when the key is let go.
    private func step(_ part: Part, by delta: Double, commits: Bool = true) {
        guard isEnabled else { return }
        var newStart = start
        var newEnd = end
        switch part {
        case .start: newStart = RangeEdit.start(start + delta, end: end, minimumLength: minimumLength)
        case .end:
            newEnd = RangeEdit.end(end + delta, start: start, minimumLength: minimumLength, duration: duration)
        case .span: return
        }
        guard newStart != start || newEnd != end else { return }
        if commits {
            onChange(newStart, newEnd)
            onCommit(newStart, newEnd)
        } else {
            if let onKeyStep { onKeyStep(newStart, newEnd) } else { onChange(newStart, newEnd) }
            keySteps.stepped(start: newStart, end: newEnd)
        }
        onReveal?(part == .start ? newStart : newEnd)
    }

    /// Commits a run of arrow-key steps where the last one left the span.
    private func commitKeySteps() {
        guard let span = keySteps.end() else { return }
        onCommit(span.start, span.end)
    }
}

/// Reads the closing progress below the leaving span's transition, which sets it on
/// `RangeHandles`'s content and so never reaches `RangeHandles` itself.
private struct RangeClosingReader<Content: View>: View {
    @ViewBuilder let content: (Double) -> Content

    @Environment(\.rangeClosing) private var closing

    var body: some View {
        content(closing)
    }
}

extension EnvironmentValues {
    /// How far a leaving span has closed to its center, from 0 to 1.
    @Entry fileprivate var rangeClosing = 0.0
}

/// Closes a leaving span to its center. The progress reaches the span's drawing through the
/// environment, so its edges move rather than the whole strip scaling.
private struct RangeClosingTransition: Transition {
    func body(content: Content, phase: TransitionPhase) -> some View {
        content.modifier(RangeClosingEffect(progress: phase == .didDisappear ? 1 : 0))
    }
}

@Animatable
private struct RangeClosingEffect: ViewModifier {
    var progress: Double

    func body(content: Content) -> some View {
        content.environment(\.rangeClosing, progress)
    }
}

/// Whether a drag snaps now: not while Option is held on a hardware keyboard.
private enum Snapping {
    @MainActor static var isOn: Bool {
        #if os(iOS)
            let keys = GCKeyboard.coalesced?.keyboardInput
            return ![GCKeyCode.leftAlt, .rightAlt].contains { keys?.button(forKeyCode: $0)?.isPressed == true }
        #else
            !NSEvent.modifierFlags.contains(.option)
        #endif
    }
}

/// One edge's mark: a line the height of the strip with a grip tab centered on it, outside the
/// span so the tab never covers the audio inside.
private struct HandleMark: View {
    let isStart: Bool
    let color: Color
    /// The full tab height, or the strip's height where the strip is shorter.
    let tabHeight: CGFloat
    let isLifted: Bool
    let isFocused: Bool
    /// Under the pointer or held, which widens the Mac's grip.
    let isHovered: Bool
    /// Counts the snaps the edge has entered; each change pops the tab once.
    let snaps: Int
    let time: Double
    /// Formats `time` for the bubble, only while the edge is held.
    let bubbleText: (Double) -> String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    #if os(macOS)
        private static let radius = RangeHandles.macGrip.radius
        private static let hoveredWidth: CGFloat = 1.15
    #else
        private static let radius: CGFloat = 6
    #endif
    private static let liftedScale: CGFloat = 1.15
    /// The pop's peak, relative to the lifted tab, so a snapped tab reaches 130%.
    private static let snapScale: CGFloat = 1.3 / 1.15

    private var shape: UnevenRoundedRectangle {
        isStart
            ? UnevenRoundedRectangle(topLeadingRadius: Self.radius, bottomLeadingRadius: Self.radius)
            : UnevenRoundedRectangle(bottomTrailingRadius: Self.radius, topTrailingRadius: Self.radius)
    }

    private var tabWidth: CGFloat {
        #if os(macOS)
            RangeHandles.macGrip.width * (isHovered ? Self.hoveredWidth : 1)
        #else
            RangeHandles.tabWidth
        #endif
    }

    private var tabOffset: CGFloat {
        isStart ? -tabWidth / 2 : tabWidth / 2
    }

    var body: some View {
        #if os(macOS)
            ZStack {
                Rectangle()
                    .fill(color)
                    .frame(width: 2)
                    .background { Rectangle().fill(Palette.surface).frame(width: 4) }
                shape
                    .fill(color)
                    // A centered stroke shows its outer half, a point outside the tab.
                    .background { shape.stroke(Palette.surface, lineWidth: 2) }
                    .frame(width: tabWidth, height: tabHeight)
                    .overlay { grip }
                    .macFocusRing(isFocused, shape: shape)
                    .offset(x: tabOffset)
            }
            .macAnimation(MacMotion.hover, value: isHovered)
        #else
            ZStack {
                Rectangle().fill(color).frame(width: 2)
                tab.offset(x: tabOffset)
            }
            .overlay(alignment: .top) {
                ZStack {
                    if isLifted { timeBubble.transition(.opacity) }
                }
                .phoneAnimation(Motion.state, value: isLifted)
            }
        #endif
    }

    #if !os(macOS)
        private var tab: some View {
            let peak = reduceMotion ? 1 : Self.snapScale
            return
                shape
                .fill(color)
                .frame(width: RangeHandles.tabWidth, height: tabHeight)
                .overlay { grip }
                .libraryFocusRing(isFocused, shape: shape)
                .keyframeAnimator(initialValue: 1.0, trigger: snaps) { tab, pop in
                    tab.scaleEffect(pop)
                } keyframes: { _ in
                    SpringKeyframe(peak, duration: 0.12, spring: Motion.springCurve)
                    SpringKeyframe(1, spring: Motion.springCurve)
                }
                .scaleEffect(isLifted ? Self.liftedScale : 1)
                .elevation(.control, isShown: isLifted)
                .phoneAnimation(Motion.spring, reduced: nil, value: isLifted)
        }

        private var timeBubble: some View {
            Text(bubbleText(time))
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Palette.textPrimary)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .modifier(GlassCapsule())
                .padding(.top, 4)
                .accessibilityHidden(true)
        }
    #endif

    private var grip: some View {
        HStack(spacing: 2) {
            ForEach(0..<2, id: \.self) { _ in
                Capsule().fill(Palette.onAccentFill).frame(width: 1.5, height: 16)
            }
        }
    }
}

#Preview("Range handles") {
    @Previewable @State var span = (start: 40.0, end: 90.0)
    @Previewable @State var loopID: Int? = 1
    let duration = 195.0
    VStack(spacing: 16) {
        GeometryReader { proxy in
            let width = proxy.size.width
            if let loopID {
                RangeHandles(
                    start: span.start, end: span.end, duration: duration, color: Palette.loop(0, scheme: .light),
                    wash: Palette.loopTint(0, scheme: .light),
                    scale: { CGFloat($0 / duration) * width }, time: { Double($0 / max(width, 1)) * duration },
                    snapPoints: [60, 120], playhead: 100, minimumLength: 0.5, movesSpan: true, insertionID: loopID,
                    onChange: { start, end in span = (start, end) }, onCommit: { _, _ in }
                )
            }
        }
        .frame(height: 128)
        .background(Palette.surface)
        Button(loopID == nil ? "New loop" : "Delete loop") { loopID = loopID == nil ? 1 : nil }
    }
    .padding()
}
