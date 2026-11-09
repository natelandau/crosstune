import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// What holds the keyboard on the recording screen when no control does: the screen itself.
enum PracticeFocus: Hashable {
    case screen
}

/// The recording at one scale with a time ruler, centered on a fixed playhead. A drag scrolls
/// the audio under the playhead, which is the seek, and coasts on when let go; a tap selects
/// the loop under it or deselects. Every loop shows as a tint with a name tab, and the selected
/// loop has range handles: a drag on an edge, the arrow keys, and VoiceOver move that edge,
/// and a drag inside the loop scrubs. Before the start and after the end the view stays blank
/// rather than clamping. Until the recording's length is known, a plain timeline bar shows
/// instead.
struct PracticeWaveform: View {
    let model: PracticeModel
    let peaks: ShownPeaks?
    var accessibilityFocus: AccessibilityFocusState<Bool>.Binding

    @Environment(\.colorScheme) private var colorScheme
    /// Whether the drag under way has begun scrubbing, so its first move holds playback.
    @State private var isScrubbing = false
    /// Reset however a gesture ends, cancelled included, so each always lets go.
    @GestureState private var scrubPressed = false
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

    var body: some View {
        let player = model.player
        // The player reports its position only a few times a second, so while it plays the view
        // redraws every frame and runs the playhead on in between. A momentum scroll's position
        // comes from the clock, so it redraws every frame too.
        let still = model.momentumScroll == nil && (!model.isPlaying || model.draggedMs != nil)
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
        .onChange(of: isPinching) { _, pinching in
            if !pinching { model.endPinch() }
        }
    }

    private var timelineBar: some View {
        Canvas { context, size in
            #if os(macOS)
                context.fill(
                    .peakBars(nil, in: CGRect(origin: .zero, size: size)), with: .color(MacWave.placeholder))
            #else
                context.fill(
                    .peakBars(nil, in: CGRect(origin: .zero, size: size)),
                    with: .quietBars)
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
            // The ruler has a fixed height and tick spacing, so its labels stop growing at the
            // default size.
            .dynamicTypeSize(...DynamicTypeSize.large)
            .frame(height: Self.rulerHeight)
            .accessibilityHidden(true)
            ZStack(alignment: .topLeading) {
                surface(view, placed: placed)
                tabs(view, placed: placed)
                handles(view)
                // Over the handles' dim, so the playhead reads at full strength outside the loop.
                // Without a dim, the surface draws it under the handles.
                if RangeHandles.drawsWash {
                    // A shape with fixed inputs, so each frame leaves it as drawn.
                    Rectangle()
                        .fill(Palette.playhead)
                        .frame(width: 2)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .frame(maxHeight: .infinity)
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

    private static func playheadRect(in size: CGSize) -> CGRect {
        CGRect(x: size.width / 2 - 1, y: 0, width: 2, height: size.height)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize, view: ZoomedWaveformView, placed: [PlacedLoop]) {
        let width = Double(size.width)
        let lengthMs = Double(model.lengthMs)
        context.fillZoomedBars(
            view: view, lengthMs: lengthMs, peaks: peaks, size: size,
            placeholderOnMac: true)
        let selectedID = model.selectedID
        for loop in placed {
            // The selected loop's handles wash it themselves where they draw a wash.
            if loop.id == selectedID, RangeHandles.drawsWash { continue }
            let start = max(0, view.x(ofSourceMs: Double(loop.span.startMs)))
            let end = min(width, view.x(ofSourceMs: Double(loop.span.endMs)))
            guard end > start else { continue }
            let tint =
                loop.id == selectedID
                ? Palette.loopTint(loop.color, scheme: colorScheme)
                : Palette.loopTintUnselected(loop.color, scheme: colorScheme)
            context.fill(
                Path(CGRect(x: start, y: 0, width: end - start, height: Double(size.height))), with: .color(tint))
        }
        if !RangeHandles.drawsWash { context.fillPlayhead(Self.playheadRect(in: size)) }
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
                    with: .rulerTick)
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

    /// The selected loop's range handles, in seconds on the trimmed timeline.
    @ViewBuilder
    private func handles(_ view: ZoomedWaveformView) -> some View {
        if let row = model.selected, let span = model.shownSpan(row.id) {
            let start = model.handleSeconds(span.startMs)
            let end = model.handleSeconds(span.endMs)
            let x = { (seconds: Double) in view.x(ofSourceMs: Double(model.trimStartMs) + seconds * 1000) }
            let name = model.name(row)
            let spanOf = { (start: Double, end: Double) in
                LoopSpan(startMs: model.sourceMs(handleSeconds: start), endMs: model.sourceMs(handleSeconds: end))
            }
            RangeHandles(
                start: start, end: end, duration: Double(model.lengthMs) / 1000,
                color: Palette.loop(row.color, scheme: colorScheme),
                wash: Palette.loopTint(row.color, scheme: colorScheme),
                scale: { CGFloat(x($0)) },
                time: { (view.sourceMs(atX: Double($0)) - Double(model.trimStartMs)) / 1000 },
                snapPoints: model.handleSnapPointsMs.map(model.handleSeconds),
                playhead: Double(model.centerMs) / 1000,
                minimumLength: Double(LoopModel.minLoopMs) / 1000, movesSpan: false,
                insertionID: model.insertedID == row.id ? row.id : nil,
                startLabel: PracticeText.loopStart, endLabel: PracticeText.loopEnd,
                // Each edge's value names its loop and its side; the start is the lesser time.
                valueText: {
                    PracticeModel.handleValue(
                        $0 == start ? .start : .end, of: name, atMs: model.sourceMs(handleSeconds: $0),
                        from: model.trimStartMs)
                },
                onEdgeScroll: { model.scrollUnderHandle(depth: $0) },
                // The target reaches past the loop's edge, so a tap on it is a tap on the waveform.
                onTap: { model.tap(atX: x($0)) },
                onReveal: { model.reveal(model.sourceMs(handleSeconds: $0)) },
                onKeyStep: { start, end in model.moveHandles(to: spanOf(start, end), byKeyStep: true) },
                onChange: { start, end in model.moveHandles(to: spanOf(start, end)) },
                onCommit: { start, end in model.commitHandles(spanOf(start, end)) }
            )
            // A new loop gets new handles, so no drag, snap, or key step carries over.
            .id(row.id)
            // The opening plays once; a rebuilt view never replays it.
            .onAppear { model.insertedID = nil }
        }
    }
}

/// What sits over the waveform's bottom corners: the readout at the left, unless it sits under
/// the waveform, and the zoom control at the right. Each blocks the waveform under it, so a
/// press here never scrubs, taps, or grabs a handle; the gap between them stays the waveform's.
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
            ZoomControl(
                canZoomOut: model.canZoomOut, canZoomIn: model.canZoomIn, canFit: model.scale != nil,
                onZoomOut: { model.zoom(by: 1 / WaveformSteps.zoomStep) }, onFit: model.fit,
                onZoomIn: { model.zoom(by: WaveformSteps.zoomStep) }
            )
            .disabled(disabledReason != nil)
        }
        .padding(4)
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
                .animation(minimumInterval: 0.1, paused: !model.isPlaying && model.momentumScroll == nil)
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

/// The page's background, mostly opaque on iOS and fully on the Mac, so text and buttons read
/// over bars and loop tints. Its shape takes every press, so none falls through to the waveform.
private struct Backing: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
            // Nearly opaque, so a loop's tint and handle lines all but stop at its edge, and
            // lifted by a soft shadow rather than outlined.
            content
                .background {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Palette.surfaceRaised)
                        .elevation(.control)
                }
                .contentShape(.rect(cornerRadius: 8))
        #else
            content
                .background(Palette.pageBackgroundTranslucent, in: .rect(cornerRadius: 8))
                .contentShape(.rect(cornerRadius: 8))
        #endif
    }
}

extension GraphicsContext.Shading {
    /// The recording screen's playhead line.
    static var playhead: Self { .color(Palette.playhead) }
}

#if os(macOS)
    extension Color {
        /// A point of the stage's color around a handle or the playhead, so it reads
        /// where it crosses a loop's band.
        static var markOutline: Color { Palette.surface }
    }

    /// The Mac waveform's own marks on the practice stage.
    enum MacWave {
        /// Bars in place of a waveform not yet on hand, quieter than any real bar.
        static var placeholder: Color { Palette.border }
        static var tick: Color { Palette.textTertiary }
        static let tickHeight: CGFloat = 5
    }
#endif

/// A zoomed waveform's colors: what has played, left of the fixed playhead, in the text color,
/// and what is to come faint, in both appearances.
enum Wave {
    static var played: Color { Palette.textPrimary }
    static var unplayed: Color { Palette.textTertiary }
}

extension GraphicsContext {
    /// Draws a zoomed waveform's bars over the recording's own stretch of `view`, so the view
    /// past either end stays blank: what has played, left of the fixed center, apart from what
    /// is to come. Without peaks, the Mac draws
    /// placeholder bars when `placeholderOnMac` is set, and a plain timeline bar otherwise.
    func fillZoomedBars(
        view: ZoomedWaveformView, lengthMs: Double, peaks: ShownPeaks?, size: CGSize, placeholderOnMac: Bool
    ) {
        let width = Double(size.width)
        let height = size.height
        let bars = ZoomedWaveformBars(view: view, lengthMs: lengthMs, displayScale: environment.displayScale)
        let x0 = max(0, -bars.offsetX)
        let x1 = min(width, lengthMs / 1000 * view.pointsPerSecond - bars.offsetX)
        guard x1 > x0 else { return }
        // A trim past the end of the peaks leaves no points, and a silent file has no level to
        // scale to; both draw as if the peaks had not come, as the overview strip does.
        let peaks = peaks.flatMap { $0.values.isEmpty || $0.loudest == 0 ? nil : $0 }
        let path =
            peaks.map { peaks in bars.path(height: height) { peaks.gridLevel(barMs: bars.barMs, index: $0) } }
            ?? BarPath.peakBars(levels: [], in: CGRect(x: x0, y: 0, width: x1 - x0, height: height))
        #if os(macOS)
            if peaks == nil, placeholderOnMac {
                fill(bars.path(height: height) { PeakBars.placeholderLevel($0) }, with: .color(MacWave.placeholder))
            } else {
                fillSplit(path, atX: width / 2, played: Wave.played, unplayed: Wave.unplayed)
            }
        #else
            fillSplit(path, atX: width / 2, played: Wave.played, unplayed: Wave.unplayed)
        #endif
    }

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
    func fillPlayhead(_ rect: CGRect) {
        #if os(macOS)
            fill(Path(rect.insetBy(dx: -1, dy: 0)), with: .color(.markOutline))
        #endif
        fill(Path(rect), with: .playhead)
    }
}

extension GraphicsContext.Shading {
    /// Quiet bars and ruler ticks, in secondary text.
    static var quietBars: Self { .color(Palette.textSecondary) }
    static var rulerTick: Self { .color(Palette.textSecondary) }
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
