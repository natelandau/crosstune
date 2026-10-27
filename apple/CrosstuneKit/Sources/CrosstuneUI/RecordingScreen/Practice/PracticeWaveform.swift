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
/// is known, a plain timeline bar shows instead.
struct PracticeWaveform: View {
    let model: PracticeModel
    let peaks: ShownPeaks?
    var focus: FocusState<PracticeFocus?>.Binding
    var accessibilityFocus: AccessibilityFocusState<Bool>.Binding

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.practiceBackground) private var practiceScheme
    /// Whether the drag under way has begun scrubbing, so its first move holds playback.
    @State private var isScrubbing = false
    /// True while Option is held on the Mac, which turns off snapping to the playhead.
    @State private var optionHeld = false
    /// Reset however a gesture ends, cancelled included, so each always lets go.
    @GestureState private var scrubPressed = false
    @GestureState private var handlePressed = false
    @GestureState private var isPinching = false
    /// Laying out a label is the ruler's costliest step, and the same labels show frame after
    /// frame while the audio plays or scrolls.
    @State private var rulerLabels = ResolvedCache<String, TextEnvironment, GraphicsContext.ResolvedText>(limit: 64)

    /// Tick spacings the ruler picks from, in ms.
    private static let tickSteps: [Double] = [
        100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000,
    ]
    /// The least room a ruler label gets.
    private static let minTickPoints: Double = 56

    /// Whether a ruler label centered on `x` stays within the waveform's `width`. A label cut by
    /// either edge would read as a different time, so it is left off and only its tick shows.
    nonisolated static func rulerLabelFits(atX x: Double, labelWidth: Double, width: Double) -> Bool {
        x - labelWidth / 2 >= 0 && x + labelWidth / 2 <= width
    }

    #if os(macOS)
        private static let rulerHeight: CGFloat = 20
    #else
        private static let rulerHeight: CGFloat = 16
    #endif
    private static let space = "practiceWaveform"

    var body: some View {
        let player = model.player
        // The player reports its position only a few times a second, so while it plays the view
        // redraws every frame and runs the playhead on in between. A momentum scroll's position
        // comes from the clock, so it redraws every frame too.
        let still = model.momentumScroll == nil && (!player.audio.isPlaying || model.draggedMs != nil)
        TimelineView(.animation(paused: still)) { _ in
            if let view = model.zoomedWaveformView {
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
            #if os(macOS)
                context.fill(
                    .peakBars(nil, in: CGRect(origin: .zero, size: size)), with: .color(MacWave.placeholder))
            #else
                context.fill(
                    .peakBars(nil, in: CGRect(origin: .zero, size: size)),
                    with: .quietBars(onPractice: practiceScheme != nil))
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
    }

    private func content(_ view: ZoomedWaveformView) -> some View {
        // Read once per frame and shared by the canvas and the name tabs.
        let placed = model.placedLoops
        return VStack(spacing: 4) {
            Canvas { context, size in
                drawRuler(in: &context, size: size, view: view)
            }
            // The ruler has a fixed height and tick spacing, so its labels stop growing at the default size.
            .dynamicTypeSize(...DynamicTypeSize.large)
            .frame(height: Self.rulerHeight)
            .accessibilityHidden(true)
            ZStack(alignment: .topLeading) {
                surface(view, placed: placed)
                tabs(view, placed: placed)
                if let row = model.selected, let span = model.shownSpan(row.id) {
                    ForEach([LoopModel.Edge.start, .end], id: \.self) { edge in
                        handle(
                            edge, at: view.x(ofSourceMs: Double(edge == .start ? span.startMs : span.endMs)), view: view
                        )
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

    private func surface(_ view: ZoomedWaveformView, placed: [PlacedLoop]) -> some View {
        Canvas { context, size in
            draw(in: &context, size: size, view: view, placed: placed)
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

    private func draw(in context: inout GraphicsContext, size: CGSize, view: ZoomedWaveformView, placed: [PlacedLoop]) {
        let width = Double(size.width)
        let lengthMs = Double(model.lengthMs)
        let bars = ZoomedWaveformBars(view: view, lengthMs: lengthMs, displayScale: context.environment.displayScale)
        // Bars cover only the recording's own stretch, so the view past either end stays blank.
        let x0 = max(0, -bars.offsetX)
        let x1 = min(width, lengthMs / 1000 * view.pointsPerSecond - bars.offsetX)
        if x1 > x0 {
            let height = size.height
            // A trim past the end of the peaks leaves no points, and a silent file has no level to
            // scale to; both draw as if the peaks had not come, as the overview strip does.
            let peaks = self.peaks.flatMap { $0.values.isEmpty || $0.loudest == 0 ? nil : $0 }
            #if os(macOS)
                if let peaks {
                    context.fillSplit(
                        bars.path(height: height) { peaks.gridLevel(barMs: bars.barMs, index: $0) },
                        atX: width / 2, played: MacWave.played, unplayed: MacWave.unplayed)
                } else {
                    context.fill(
                        bars.path(height: height) { PeakBars.placeholderLevel($0) }, with: .color(MacWave.placeholder))
                }
            #else
                let path =
                    peaks.map { peaks in bars.path(height: height) { peaks.gridLevel(barMs: bars.barMs, index: $0) } }
                    ?? BarPath.peakBars(levels: [], in: CGRect(x: x0, y: 0, width: x1 - x0, height: height))
                if practiceScheme != nil {
                    // What has played, left of the fixed playhead, is white; what is to come is silver.
                    context.fillSplit(
                        path, atX: width / 2, played: Palette.onPractice, unplayed: Palette.onPracticeSecondary)
                } else {
                    context.fill(path, with: .quietBars(onPractice: false))
                }
            #endif
        }
        let selectedID = model.selectedID
        for loop in placed {
            let start = max(0, view.x(ofSourceMs: Double(loop.span.startMs)))
            let end = min(width, view.x(ofSourceMs: Double(loop.span.endMs)))
            guard end > start else { continue }
            let tint = Palette.loopTint(loop.color, scheme: colorScheme)
            context.fill(
                Path(CGRect(x: start, y: 0, width: end - start, height: Double(size.height))),
                with: .color(loop.id == selectedID ? tint : tint.opacity(0.5)))
        }
        context.fillPlayhead(
            CGRect(x: width / 2 - 1, y: 0, width: 2, height: Double(size.height)), onPractice: practiceScheme != nil)
    }

    private func drawRuler(in context: inout GraphicsContext, size: CGSize, view: ZoomedWaveformView) {
        let step = Self.tickSteps.first { $0 / 1000 * view.pointsPerSecond >= Self.minTickPoints } ?? 300_000
        let last = min(view.endMs, Double(model.lengthMs))
        let environment = TextEnvironment(context.environment)
        var tick = max(0, (view.startMs / step).rounded(.up) * step)
        while tick <= last {
            let x = (tick - view.startMs) / 1000 * view.pointsPerSecond
            let label =
                step < 1000
                ? RecordingScreenText.preciseTime(milliseconds: Int64(tick))
                : RecordingText.duration(of: Int64(tick))
            #if os(macOS)
                // A short tick at the ruler's foot with its label centered over it.
                context.fill(
                    Path(CGRect(x: x - 0.5, y: size.height - MacWave.tickHeight, width: 1, height: MacWave.tickHeight)),
                    with: .color(MacWave.tick))
                let text = rulerLabels.value(for: label, in: environment) {
                    context.resolve(
                        Text(label).font(MacStyle.secondary).monospacedDigit().foregroundStyle(Palette.textSecondary))
                }
                let labelWidth = Double(text.measure(in: size).width)
                if Self.rulerLabelFits(atX: x, labelWidth: labelWidth, width: Double(size.width)) {
                    context.draw(text, at: CGPoint(x: x, y: 0), anchor: .top)
                }
            #else
                context.fill(
                    Path(CGRect(x: x, y: 0, width: 1, height: size.height)),
                    with: .rulerTick(onPractice: practiceScheme != nil))
                let text = rulerLabels.value(for: label, in: environment) {
                    context.resolve(
                        Text(label).font(.platform(.caption2)).monospacedDigit().foregroundStyle(.textSecondary))
                }
                context.draw(text, at: CGPoint(x: x + 3, y: 0), anchor: .topLeading)
            #endif
            tick += step
        }
    }

    // MARK: Name tabs

    @ViewBuilder
    private func tabs(_ view: ZoomedWaveformView, placed: [PlacedLoop]) -> some View {
        let selectedID = model.selectedID
        let rows = model.rowsByID
        ForEach(placed, id: \.id) { loop in
            let start = max(0, view.x(ofSourceMs: Double(loop.span.startMs)))
            let end = min(view.width, view.x(ofSourceMs: Double(loop.span.endMs)))
            // Inset by half a handle, so a tab never sits under its loop's start handle.
            let left = start + PracticeModel.handleReach
            if end > start {
                LoopNameTab(
                    model: model, loop: loop, row: rows[loop.id], isSelected: loop.id == selectedID,
                    maxWidth: max(0, end - PracticeModel.handleReach - left)
                )
                .offset(x: left)
            }
        }
    }

    // MARK: Handles

    private func handle(_ edge: LoopModel.Edge, at x: Double, view: ZoomedWaveformView) -> some View {
        let inView = x >= 0 && x <= view.width
        let name = edge == .start ? PracticeText.loopStart : PracticeText.loopEnd
        return HandleMark(edge: edge, color: Self.handleColor(isTrim: false))
            .frame(width: PracticeModel.handleReach * 2)
            .frame(maxHeight: .infinity)
            .contentShape(.rect)
            .offset(x: min(max(x, 0), view.width) - PracticeModel.handleReach)
            // Keyed on the snap, so only a jump onto or off a snap point eases; a drag's own
            // moves and the waveform's scroll stay locked to the finger and the playhead.
            .phoneAnimation(.spring(duration: 0.3, bounce: 0.3), reduced: nil, value: model.handleDrag?.snappedTo)
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

    /// A handle's color: every loop's in the brand color, the one color for what marks a
    /// position, which leaves the loop's own color to its band and tab; trim's plain white on the
    /// practice background, so editing reads apart from practice.
    static func handleColor(isTrim: Bool) -> Color {
        isTrim ? .white : Palette.brand
    }

    /// One VoiceOver step: a change of its own, written at once.
    private func step(_ edge: LoopModel.Edge, by deltaMs: Int64) {
        model.nudge(edge, by: deltaMs)
        model.commitNudge()
    }
}

/// What sits over the waveform's bottom corners: the readout at the left, unless it sits under
/// the waveform, and Zoom out, Fit, and Zoom in at the right. Each
/// sits on a backing that blocks the waveform under it, so a press here never scrubs, taps, or
/// grabs a handle; the gap between them stays the waveform's.
struct WaveformOverlay: View {
    let model: PracticeModel
    /// Why the waveform, transport, and modes cannot be used yet, shown in place of the readout.
    let disabledReason: String?
    /// False where the readout sits under the waveform instead.
    var showsReadout = true

    @Environment(\.spacing) private var spacing

    var body: some View {
        HStack(alignment: .bottom, spacing: spacing(8)) {
            if showsReadout {
                PracticeReadout(model: model, disabledReason: disabledReason)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .modifier(Backing())
            }
            Spacer(minLength: 0)
            HStack(spacing: 0) {
                iconButton(RecordingScreenText.zoomOut, systemImage: "minus.magnifyingglass") {
                    model.zoom(by: 1 / PracticeModel.zoomStep)
                }
                .keyboardShortcut("-", modifiers: .command)
                .disabled(!model.canZoomOut)
                #if os(macOS)
                    iconButton(PracticeText.fit, systemImage: "arrow.left.and.right") { model.fit() }
                        .disabled(model.scale == nil)
                #else
                    Button {
                        model.fit()
                    } label: {
                        Text(PracticeText.fit)
                            .font(.platform(.subheadline))
                            .frame(minWidth: PracticeLayout.target, minHeight: PracticeLayout.target)
                            .contentShape(.rect)
                    }
                    .disabled(model.scale == nil)
                    .accessibilityShowsLargeContentViewer()
                #endif
                iconButton(RecordingScreenText.zoomIn, systemImage: "plus.magnifyingglass") {
                    model.zoom(by: PracticeModel.zoomStep)
                }
                .keyboardShortcut("=", modifiers: .command)
                .disabled(!model.canZoomIn)
            }
            #if os(macOS)
                .buttonStyle(.mac(.icon, size: .small))
                .padding(2)
            #else
                .buttonStyle(.borderless)
            #endif
            .disabled(disabledReason != nil)
            // Capped so the cluster stays a corner control that never reaches the playhead.
            .dynamicTypeSize(...DynamicTypeSize.large)
            .modifier(Backing())
        }
        .padding(4)
    }

    private func iconButton(_ name: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            #if os(macOS)
                Label(name, systemImage: systemImage)
                    .labelStyle(.iconOnly)
            #else
                Label(name, systemImage: systemImage)
                    .labelStyle(.iconOnly)
                    .font(.platform(.body))
                    .frame(minWidth: PracticeLayout.target, minHeight: PracticeLayout.target)
                    .contentShape(.rect)
            #endif
        }
        .help(name)
        // Capped at the default text size, so a long press shows it enlarged.
        .accessibilityShowsLargeContentViewer()
    }
}

/// The playhead's time to the tenth of a second, or why the screen cannot be used yet.
struct PracticeReadout: View {
    let model: PracticeModel
    let disabledReason: String?

    var body: some View {
        if let disabledReason {
            Text(disabledReason)
                .font(.platform(.subheadline).weight(.semibold))
                .foregroundStyle(.textSecondary)
                .lineLimit(2)
        } else {
            TimelineView(
                .animation(minimumInterval: 0.1, paused: !model.player.audio.isPlaying && model.momentumScroll == nil)
            ) { _ in
                Text(RecordingScreenText.preciseTime(milliseconds: Int64(model.shownCenterMs(at: model.clock()))))
                    #if os(macOS)
                        .font(MacStyle.readout)
                        .foregroundStyle(Palette.textPrimary)
                    #else
                        .font(.platform(.title3).weight(.semibold))
                        .monospacedDigit()
                    #endif
            }
            .accessibilityHidden(true)
        }
    }
}

/// The page's background, or the practice background where the screen is drawn on it, mostly
/// opaque on iOS and fully on the Mac, so text and buttons read over bars and loop tints.
/// Its shape takes every press, so none falls through to the waveform.
private struct Backing: ViewModifier {
    @Environment(\.practiceBackground) private var practiceScheme

    func body(content: Content) -> some View {
        #if os(macOS)
            // Nearly opaque, so a loop's tint and handle lines all but stop at its edge, and
            // lifted by a soft shadow rather than outlined.
            content
                .background {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Palette.pageBackground.opacity(0.92))
                        .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
                }
                .contentShape(.rect(cornerRadius: 8))
        #else
            content
                .background(fill.opacity(0.8), in: .rect(cornerRadius: 8))
                .contentShape(.rect(cornerRadius: 8))
        #endif
    }

    private var fill: AnyShapeStyle {
        practiceScheme.map { AnyShapeStyle(Palette.practiceBackground($0)) } ?? AnyShapeStyle(.background)
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
                #if os(macOS)
                    .background { Rectangle().fill(Color.markOutline).frame(width: 4) }
                #endif
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
            #if os(macOS)
                // A centered stroke shows its outer half, a point outside the tab.
                .background { shape.stroke(Color.markOutline, lineWidth: 2) }
            #endif
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

extension GraphicsContext.Shading {
    /// The recording screen's playhead line: the brand color beside the loop handles on the Mac
    /// and on the practice background, plain otherwise.
    static func playhead(onPractice: Bool) -> Self {
        #if os(macOS)
            .color(Palette.brand)
        #else
            onPractice ? .color(Palette.brand) : .style(.primary)
        #endif
    }
}

#if os(macOS)
    extension Color {
        /// A point of the stage's color around a brand-colored handle or playhead, so it reads where it
        /// crosses a loop's orange band.
        static var markOutline: Color { Palette.surface }
    }

    /// The Mac waveform's colors on the practice stage: what has played, left of the fixed
    /// playhead, near the full text color, and what is to come faint, in both appearances.
    enum MacWave {
        static var played: Color { Palette.textPrimary.opacity(0.85) }
        static var unplayed: Color { Palette.textPrimary.opacity(0.28) }
        /// Bars in place of a waveform not yet on hand, quieter than any real bar.
        static var placeholder: Color { Palette.textPrimary.opacity(0.12) }
        static var tick: Color { Palette.textSecondary.opacity(0.6) }
        static let tickHeight: CGFloat = 5
    }
#endif

extension GraphicsContext {
    /// Fills `path` in `played` left of `x` and in `unplayed` from it on.
    func fillSplit(_ path: BarPath, atX x: Double, played: Color, unplayed: Color) {
        // An empty path's bounds are the null rect, whose infinite origin would make each clip NaN.
        guard !path.isEmpty else { return }
        // Two clips sized to the path, never an inverse clip or one far past it: the GPU renderer
        // can paint a tile under both, which shows where a color is translucent.
        let bounds = path.boundingRect.insetBy(dx: -1, dy: -1)
        let split = min(max(CGFloat(x), bounds.minX), bounds.maxX)
        var before = self
        before.clip(to: Path(CGRect(x: bounds.minX, y: bounds.minY, width: split - bounds.minX, height: bounds.height)))
        before.fill(path, with: .color(played))
        var after = self
        after.clip(to: Path(CGRect(x: split, y: bounds.minY, width: bounds.maxX - split, height: bounds.height)))
        after.fill(path, with: .color(unplayed))
    }
}

extension GraphicsContext {
    /// Draws the playhead line in `rect`, outlined on the Mac as its loop handles are.
    func fillPlayhead(_ rect: CGRect, onPractice: Bool) {
        #if os(macOS)
            fill(Path(rect.insetBy(dx: -1, dy: 0)), with: .color(.markOutline))
        #endif
        fill(Path(rect), with: .playhead(onPractice: onPractice))
    }
}

extension GraphicsContext.Shading {
    /// Quiet bars on the page, in secondary text; on the dark practice background, the system's
    /// tertiary.
    static func quietBars(onPractice: Bool) -> Self {
        if !onPractice { return .color(Palette.textSecondary) }
        return .style(.tertiary)
    }

    /// Ruler ticks on the page, in secondary text; on the dark practice background, the system's
    /// secondary.
    static func rulerTick(onPractice: Bool) -> Self {
        if !onPractice { return .color(Palette.textSecondary) }
        return .style(.secondary)
    }
}

/// The heights of a waveform's bars, as shares of the bars' full height.
enum PeakBars {
    static let barWidth: CGFloat = 2
    static let step: CGFloat = 3

    /// How many bars fit across `width`.
    static func count(in width: CGFloat) -> Int { Int(width / step) }

    /// `peaks` as `count` bars. With none, the Mac shows placeholder bars, so a recording whose
    /// waveform has not arrived still reads as audio; iPhone and iPad show none.
    static func levels(_ peaks: ShownPeaks?, count: Int) -> [CGFloat] {
        let levels = peaks?.bars(count) ?? []
        #if os(macOS)
            if levels.isEmpty { return placeholder(count) }
        #endif
        return levels
    }

    /// A low, gently uneven run of `count` bars.
    static func placeholder(_ count: Int) -> [CGFloat] {
        (0..<max(0, count)).map(placeholderLevel)
    }

    /// The placeholder level of bar `index` of the recording.
    static func placeholderLevel(_ index: Int) -> CGFloat {
        let index = Double(index)
        let ripple = 0.5 + 0.5 * sin(index * 0.21)
        let swell = 0.6 + 0.4 * sin(index * 0.057 + 1.3)
        return CGFloat(0.14 + 0.16 * ripple * swell)
    }
}

/// The recording's bars across the zoomed view. Each bar covers a fixed stretch of the recording
/// at this scale, so a scroll moves the bars rather than resampling them under a still comb.
struct ZoomedWaveformBars {
    /// How much of the recording one bar covers.
    let barMs: Double
    /// The x of the recording's start, negated: how far the view has scrolled into it, snapped to
    /// a device pixel so every bar keeps the same pixel phase and its edges stay sharp as it moves.
    let offsetX: Double
    /// The bars in view, by index from the recording's start; nil when none are.
    let indices: ClosedRange<Int>?

    init(view: ZoomedWaveformView, lengthMs: Double, displayScale: CGFloat) {
        let step = Double(PeakBars.step)
        let scale = Double(max(1, displayScale))
        barMs = step / view.pointsPerSecond * 1000
        offsetX = (view.startMs / 1000 * view.pointsPerSecond * scale).rounded() / scale
        let first = max(0, Int((offsetX / step).rounded(.down)))
        let last = min(
            Int((lengthMs / barMs).rounded(.up)) - 1, Int(((offsetX + view.width) / step).rounded(.down)))
        indices = first <= last ? first...last : nil
    }

    /// The x of bar `index` from the recording's start, in the view.
    func x(of index: Int) -> Double { Double(index) * Double(PeakBars.step) - offsetX }

    /// The bars in view, `level` giving each bar's height by its index from the recording's start,
    /// nil once past the points.
    func path(height: CGFloat, level: (Int) -> CGFloat?) -> BarPath {
        var path = BarPath(width: PeakBars.barWidth)
        guard let indices else { return path }
        for index in indices {
            guard let level = level(index) else { break }
            let bar = max(2, level * height)
            path.add(CGRect(x: x(of: index), y: (height - bar) / 2, width: PeakBars.barWidth, height: bar))
        }
        return path
    }
}

extension BarPath {
    /// `peaks` as bars across `rect`, or with none, a plain timeline bar, or on the Mac
    /// placeholder bars.
    static func peakBars(_ peaks: ShownPeaks?, in rect: CGRect) -> BarPath {
        peakBars(levels: PeakBars.levels(peaks, count: PeakBars.count(in: rect.width)), in: rect)
    }

    /// `levels` as bars across `rect`, or a plain timeline bar when there are none.
    static func peakBars(levels: [CGFloat], in rect: CGRect) -> BarPath {
        guard !levels.isEmpty else {
            var path = BarPath(width: 4)
            path.add(CGRect(x: rect.minX, y: rect.midY - 2, width: rect.width, height: 4))
            return path
        }
        var path = BarPath(width: PeakBars.barWidth)
        for (index, level) in levels.enumerated() {
            let bar = max(2, level * rect.height)
            path.add(
                CGRect(
                    x: rect.minX + CGFloat(index) * PeakBars.step, y: rect.midY - bar / 2,
                    width: PeakBars.barWidth, height: bar))
        }
        return path
    }
}
