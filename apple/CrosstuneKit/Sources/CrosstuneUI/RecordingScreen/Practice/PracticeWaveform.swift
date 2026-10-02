import CrosstuneStore
import SwiftUI

#if os(iOS)
    import GameController
#elseif os(macOS)
    import AppKit
#endif

/// What holds the keyboard on the recording screen: the screen itself, or one of the selected
/// loop's handles.
enum PracticeFocus: Hashable {
    case screen
    case handle(LoopModel.Edge)
}

/// The recording at one scale with a time ruler, centered on a fixed playhead. A drag scrolls
/// the audio under the playhead, which is the seek, and coasts on when let go; a tap selects
/// the loop under it or deselects. Every loop shows as a tint with a name tab, and the selected
/// loop's edges are handles that a drag, the arrow keys, and VoiceOver move. Before the start
/// and after the end the view stays blank rather than clamping. Until the recording's length
/// is known, a plain timeline bar stands in.
struct PracticeWaveform: View {
    let model: PracticeModel
    let peaks: ShownPeaks?
    var focus: FocusState<PracticeFocus?>.Binding
    var accessibilityFocus: AccessibilityFocusState<Bool>.Binding

    @Environment(\.colorScheme) private var colorScheme
    /// Whether the drag under way has begun scrubbing, so its first move holds playback.
    @State private var isScrubbing = false
    /// True while Option is held on the Mac, which turns off snapping to the playhead.
    @State private var optionHeld = false
    /// Reset however a gesture ends, cancelled included, so each always lets go.
    @GestureState private var scrubPressed = false
    @GestureState private var handlePressed = false
    @GestureState private var isPinching = false

    /// Tick spacings the ruler picks from, in ms.
    private static let tickSteps: [Double] = [
        100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000,
    ]
    /// The least room a ruler label gets.
    private static let minTickPoints: Double = 56
    private static let rulerHeight: CGFloat = 16
    private static let space = "practiceWaveform"

    var body: some View {
        let player = model.player
        // The player reports its position only a few times a second, so while it plays the view
        // redraws every frame and runs the playhead on in between.
        TimelineView(.animation(paused: !player.audio.isPlaying || model.scrubbingMs != nil)) { _ in
            if let view = model.laneView {
                content(view)
            } else {
                timelineBar
            }
        }
        .onGeometryChange(for: Double.self) {
            Double($0.size.width)
        } action: {
            model.setWidth($0)
        }
        .onChange(of: player.audio.elapsed, initial: true) { _, elapsed in model.noteElapsed(elapsed) }
        .onChange(of: model.lengthMs) { _, _ in model.ensureZoom() }
        .onChange(of: scrubPressed) { _, pressed in
            if !pressed { endScrub(predictedDx: nil) }
        }
        .onChange(of: handlePressed) { _, pressed in
            if !pressed { model.cancelHandleDrag() }
        }
        .onChange(of: isPinching) { _, pinching in
            if !pinching { model.endPinch() }
        }
        .task(id: model.autoPan != 0) {
            while model.autoPan != 0, !Task.isCancelled {
                model.autoPanStep()
                try? await Task.sleep(for: .milliseconds(16))
            }
        }
        #if os(iOS)
            .sensoryFeedback(.impact(weight: .light), trigger: model.snaps)
        #elseif os(macOS)
            // A change only reports keys pressed after the view appears, so one already held is
            // read on appear.
            .onAppear { optionHeld = NSEvent.modifierFlags.contains(.option) }
            .onModifierKeysChanged(mask: .option) { _, keys in optionHeld = keys.contains(.option) }
        #endif
    }

    /// Whether a handle's drag snaps to the playhead now: not while Option is held on a
    /// hardware keyboard. The Mac hears Option change; an iPad's keyboard is read as the drag
    /// moves.
    private var snaps: Bool {
        #if os(iOS)
            let keys = GCKeyboard.coalesced?.keyboardInput
            return ![GCKeyCode.leftAlt, .rightAlt].contains { keys?.button(forKeyCode: $0)?.isPressed == true }
        #else
            !optionHeld
        #endif
    }

    private var timelineBar: some View {
        Canvas { context, size in
            context.fillPeakBars(nil, in: CGRect(origin: .zero, size: size), style: .tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
    }

    private func content(_ view: LaneView) -> some View {
        VStack(spacing: 4) {
            Canvas { context, size in
                drawRuler(in: &context, size: size, view: view)
            }
            .frame(height: Self.rulerHeight)
            .accessibilityHidden(true)
            ZStack(alignment: .topLeading) {
                surface(view)
                tabs(view)
                if let row = model.selected, let span = model.shownSpan(row.id) {
                    ForEach([LoopModel.Edge.start, .end], id: \.self) { edge in
                        handle(
                            edge, at: view.x(ofSourceMs: Double(edge == .start ? span.startMs : span.endMs)),
                            color: row.color, view: view)
                    }
                }
            }
            .frame(maxHeight: .infinity)
            .coordinateSpace(.named(Self.space))
        }
        .simultaneousGesture(
            MagnifyGesture()
                .updating($isPinching) { _, pinching, _ in pinching = true }
                .onChanged { value in model.pinch(value.magnification) }
        )
        #if os(macOS)
            .background { ControlScrollZoom(isEnabled: true) { factor, _ in model.zoom(by: factor) } }
        #endif
    }

    // MARK: The surface

    private func surface(_ view: LaneView) -> some View {
        Canvas { context, size in
            draw(in: &context, size: size, view: view)
        }
        .contentShape(.rect)
        .onTapGesture { location in model.tap(atX: Double(location.x)) }
        .simultaneousGesture(
            DragGesture(minimumDistance: LoopModel.dragThreshold)
                .updating($scrubPressed) { _, pressed, _ in pressed = true }
                .onChanged { value in
                    if !isScrubbing {
                        isScrubbing = true
                        model.beginScrub()
                    }
                    model.scrub(dx: Double(value.translation.width))
                }
                .onEnded { value in endScrub(predictedDx: Double(value.predictedEndTranslation.width)) }
        )
        .accessibilityElement()
        .accessibilityLabel(PracticeText.waveform)
        .accessibilityValue(model.positionText)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: model.seek(byMs: PracticeModel.arrowStepMs)
            case .decrement: model.seek(byMs: -PracticeModel.arrowStepMs)
            @unknown default: break
            }
        }
        .accessibilityFocused(accessibilityFocus)
    }

    /// Lets go of the scrub: to where it was headed, or for a drag the system took away, to
    /// where it was.
    private func endScrub(predictedDx: Double?) {
        guard isScrubbing else { return }
        isScrubbing = false
        if let predictedDx { model.endScrub(predictedDx: predictedDx) } else { model.cancelScrub() }
    }

    private func draw(in context: inout GraphicsContext, size: CGSize, view: LaneView) {
        let width = Double(size.width)
        let lengthMs = Double(model.lengthMs)
        // Bars cover only the recording's own stretch, so the view past either end stays blank.
        let drawStart = min(lengthMs, max(0, view.startMs))
        let drawEnd = max(drawStart, min(view.endMs, lengthMs))
        let x0 = (drawStart - view.startMs) / 1000 * view.pointsPerSecond
        let x1 = (drawEnd - view.startMs) / 1000 * view.pointsPerSecond
        if x1 > x0 {
            let slice = peaks?.sliced(fromMs: Int64(drawStart), toMs: Int64(drawEnd.rounded(.up)))
            context.fillPeakBars(
                slice, in: CGRect(x: x0, y: 0, width: x1 - x0, height: Double(size.height)), style: .tertiary)
        }
        let selectedID = model.selectedID
        for loop in model.placedLoops {
            let start = max(0, view.x(ofSourceMs: Double(loop.span.startMs)))
            let end = min(width, view.x(ofSourceMs: Double(loop.span.endMs)))
            guard end > start else { continue }
            let tint = LoopColor.tint(loop.color, scheme: colorScheme)
            context.fill(
                Path(CGRect(x: start, y: 0, width: end - start, height: Double(size.height))),
                with: .color(loop.id == selectedID ? tint : tint.opacity(0.5)))
        }
        context.fill(
            Path(CGRect(x: width / 2 - 1, y: 0, width: 2, height: Double(size.height))), with: .style(.primary))
    }

    private func drawRuler(in context: inout GraphicsContext, size: CGSize, view: LaneView) {
        let step = Self.tickSteps.first { $0 / 1000 * view.pointsPerSecond >= Self.minTickPoints } ?? 300_000
        let last = min(view.endMs, Double(model.lengthMs))
        var tick = max(0, (view.startMs / step).rounded(.up) * step)
        while tick <= last {
            let x = (tick - view.startMs) / 1000 * view.pointsPerSecond
            context.fill(Path(CGRect(x: x, y: 0, width: 1, height: size.height)), with: .style(.secondary))
            let label =
                step < 1000
                ? RecordingScreenText.preciseTime(milliseconds: Int64(tick))
                : RecordingText.duration(of: Int64(tick))
            context.draw(
                Text(label).font(.caption2).monospacedDigit().foregroundStyle(.secondary),
                at: CGPoint(x: x + 3, y: 0), anchor: .topLeading)
            tick += step
        }
    }

    // MARK: Name tabs

    @ViewBuilder
    private func tabs(_ view: LaneView) -> some View {
        let selectedID = model.selectedID
        ForEach(model.placedLoops, id: \.id) { loop in
            let start = max(0, view.x(ofSourceMs: Double(loop.span.startMs)))
            let end = min(view.width, view.x(ofSourceMs: Double(loop.span.endMs)))
            // Inset by half a handle, so a tab never sits under its loop's start handle.
            let left = start + PracticeModel.handleReach
            if end > start {
                LoopNameTab(
                    model: model, loop: loop, isSelected: loop.id == selectedID,
                    maxWidth: max(0, end - PracticeModel.handleReach - left)
                )
                .offset(x: left)
            }
        }
    }

    // MARK: Handles

    private func handle(_ edge: LoopModel.Edge, at x: Double, color: Int, view: LaneView) -> some View {
        let inView = x >= 0 && x <= view.width
        let name = edge == .start ? PracticeText.loopStart : PracticeText.loopEnd
        return HandleMark(edge: edge, color: LoopColor.color(color, scheme: colorScheme))
            .frame(width: PracticeModel.handleReach * 2)
            .frame(maxHeight: .infinity)
            .contentShape(.rect)
            .offset(x: min(max(x, 0), view.width) - PracticeModel.handleReach)
            .opacity(inView ? 1 : 0)
            .allowsHitTesting(inView)
            // The target reaches past the loop's edge, so a tap on it is a tap on the waveform.
            .onTapGesture(coordinateSpace: .named(Self.space)) { location in
                model.tap(atX: Double(location.x))
            }
            .highPriorityGesture(
                DragGesture(minimumDistance: LoopModel.dragThreshold, coordinateSpace: .named(Self.space))
                    .updating($handlePressed) { _, pressed, _ in pressed = true }
                    .onChanged { value in
                        if model.handleDrag == nil { model.beginHandleDrag(edge) }
                        model.dragHandle(toX: Double(value.location.x), snapping: snaps)
                    }
                    .onEnded { value in
                        model.endHandleDrag(atX: Double(value.location.x), snapping: snaps)
                    }
            )
            .focusable()
            .focused(focus, equals: .handle(edge))
            .onChange(of: focus.wrappedValue == .handle(edge)) { _, focused in
                if focused, !inView, let row = model.selected {
                    model.reveal(edge == .start ? row.startMs : row.endMs)
                }
            }
            .accessibilityElement()
            .accessibilityLabel(name)
            .accessibilityValue(model.handleValue(edge))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: step(edge, by: PracticeModel.nudgeMs)
                case .decrement: step(edge, by: -PracticeModel.nudgeMs)
                @unknown default: break
                }
            }
            .accessibilityAction(named: PracticeText.laterBySecond) { step(edge, by: PracticeModel.largeNudgeMs) }
            .accessibilityAction(named: PracticeText.earlierBySecond) { step(edge, by: -PracticeModel.largeNudgeMs) }
    }

    /// One VoiceOver step: a change of its own, written at once.
    private func step(_ edge: LoopModel.Edge, by deltaMs: Int64) {
        model.nudge(edge, by: deltaMs)
        model.commitNudge()
    }
}

/// A loop handle: a line the height of the waveform with a grab tab centered on it. The tab sits
/// outside the loop so it never covers the audio being looped.
private struct HandleMark: View {
    static let tabWidth: CGFloat = 16
    static let tabHeight: CGFloat = 44

    let edge: LoopModel.Edge
    let color: Color

    var body: some View {
        ZStack {
            Rectangle()
                .fill(color)
                .frame(width: 2)
            tab
                .offset(x: edge == .start ? -Self.tabWidth / 2 : Self.tabWidth / 2)
        }
    }

    private var tab: some View {
        let radius: CGFloat = 6
        let shape =
            edge == .start
            ? UnevenRoundedRectangle(topLeadingRadius: radius, bottomLeadingRadius: radius)
            : UnevenRoundedRectangle(bottomTrailingRadius: radius, topTrailingRadius: radius)
        return
            shape
            .fill(color)
            .frame(width: Self.tabWidth, height: Self.tabHeight)
            .overlay {
                HStack(spacing: 2) {
                    ForEach(0..<2, id: \.self) { _ in
                        Capsule().fill(.white.opacity(0.9)).frame(width: 1.5, height: 16)
                    }
                }
            }
    }
}

extension GraphicsContext {
    /// Draws `peaks` as bars across `rect`, or a plain timeline bar when there are none.
    func fillPeakBars(_ peaks: ShownPeaks?, in rect: CGRect, style: HierarchicalShapeStyle) {
        let barWidth: CGFloat = 2
        let step: CGFloat = 3
        let levels = peaks?.bars(Int(rect.width / step)) ?? []
        var path = Path()
        if levels.isEmpty {
            path.addRoundedRect(
                in: CGRect(x: rect.minX, y: rect.midY - 2, width: rect.width, height: 4),
                cornerSize: CGSize(width: 2, height: 2))
        } else {
            for (index, level) in levels.enumerated() {
                let bar = max(2, level * rect.height)
                path.addRoundedRect(
                    in: CGRect(
                        x: rect.minX + CGFloat(index) * step, y: rect.midY - bar / 2, width: barWidth, height: bar),
                    cornerSize: CGSize(width: 1, height: 1))
            }
        }
        fill(path, with: .style(style))
    }
}
