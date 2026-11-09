import CrosstuneAudio
import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// Where the musician cuts a recording down to the tune: an overview of the whole current
/// recording, a zoomed detail around the handle last touched, and a transport for hearing the
/// cut. Its model holds the player at 100% speed and no pitch shift while it shows, so what is
/// heard is exactly what is cut.
struct TrimScreen: View {
    let model: TrimModel
    let player: PlayerModel
    /// The peaks for the recording's trim range as the screen opened on it.
    let peaks: ShownPeaks?
    /// Returns to the recording screen.
    let onDone: () -> Void

    @State private var stop = SelectionStop()
    @State private var failure: String?
    @GestureState private var isPinching = false
    @FocusState private var isFocused: Bool

    /// Where the playhead is on the source, in ms: the start of the bounds until audio loads.
    fileprivate static func playheadMs(_ player: PlayerModel, in model: TrimModel) -> Double {
        Double(model.bounds.lowerBound) + (player.isRecordingAudioReady ? player.audio.elapsed * 1000 : 0)
    }

    var body: some View {
        let ready = player.isRecordingAudioReady
        let playing = ready && player.audio.isPlaying
        ScrollView {
            VStack(spacing: 20) {
                if let message = player.failure ?? failure {
                    PlayerFailureText(message)
                        .controlsColumn()
                }
                TrimStrip(
                    model: model, range: Double(model.bounds.lowerBound)...Double(model.bounds.upperBound),
                    peaks: peaks, player: player, height: 56, isDetail: false, onSeek: seek)
                TrimStrip(
                    model: model, range: model.shownDetailWindow, peaks: peaks, player: player, height: 96,
                    isDetail: true, onSeek: seek
                )
                // The overview's handles and the readouts reach everything this does.
                .accessibilityHidden(true)
                .simultaneousGesture(
                    MagnifyGesture()
                        .updating($isPinching) { _, pinching, _ in pinching = true }
                        .onChanged { model.pinch($0.magnification) },
                    including: ready ? .all : .none
                )
                #if os(macOS)
                    .background { ControlScrollZoom(isEnabled: ready) { factor, _ in model.zoom(by: factor) } }
                #endif
                VStack(spacing: 20) {
                    zoomAndReadouts
                    transport(playing: playing)
                    Button(RecordingScreenText.previewEnd) {
                        play(from: max(model.start, model.end - TrimModel.previewMs))
                    }
                    .buttonStyle(.text(macLook: .system))
                }
                .controlsColumn()
            }
            .disabled(!ready)
            .padding(16)
        }
        .navigationTitle(RecordingScreenText.trim)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .navigationBarBackButtonHidden()
        #if os(iOS)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { cancelButton }
                ConfirmToolbarItem { saveButton }
            }
        #else
            .paneBar {
                cancelButton
                .buttonStyle(.macSecondary)
                .keyboardShortcut(.cancelAction)
                .help(RecordingScreenText.cancel)
                saveButton
                .buttonStyle(.macPrimary)
                .help(RecordingScreenText.save)
            }
        #endif
        .focusable()
        .focusEffectDisabled()
        .focused($isFocused)
        .defaultFocus($isFocused, true)
        // These are off while text is typed, and a focused button keeps them.
        .onKeyPress(.space, phases: .down) { _ in
            guard ready, !TextEntry.isActive else { return .ignored }
            toggle()
            return .handled
        }
        // Held arrows repeat, sweeping the handle the detail follows, as a slider does. A focused
        // handle takes its own arrows first.
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
            guard ready, !TextEntry.isActive, press.modifiers.isDisjoint(with: .otherCommand) else {
                return .ignored
            }
            let step = press.modifiers.contains(.shift) ? WaveformSteps.largeNudgeMs : WaveformSteps.nudgeMs
            let back = press.key == .leftArrow || press.key == .downArrow
            model.nudge(model.focus, by: back ? -step : step)
            return .handled
        }
        .onChange(of: isPinching) { _, pinching in
            if !pinching { model.endPinch() }
        }
        .background { PlayerReadingWatch(player: player, onChange: follow) }
        .onDisappear {
            stop.disarm()
            model.leave()
        }
    }

    /// The readouts with the zoom control, which sits under the detail rather than over its
    /// corner, where the end handle rests when the screen opens.
    private var zoomAndReadouts: some View {
        ZoomControl(
            canZoomOut: model.canZoomOut, canZoomIn: model.canZoomIn, canFit: model.canZoomOut,
            onZoomOut: { model.zoom(by: 1 / WaveformSteps.zoomStep) }, onFit: model.fit,
            onZoomIn: { model.zoom(by: WaveformSteps.zoomStep) },
            aroundReadouts: {
                HStack(spacing: Self.readoutSpacing) {
                    readout(RecordingScreenText.startHandle, model.start - model.bounds.lowerBound)
                    readout(RecordingScreenText.length, model.length)
                    readout(RecordingScreenText.endHandle, model.end - model.bounds.lowerBound)
                }
            })
    }

    /// Between the readouts: 8 on iPhone and iPad, the stack's own on the Mac.
    private static var readoutSpacing: CGFloat? {
        #if os(macOS)
            nil
        #else
            8
        #endif
    }

    private func readout(_ name: String, _ milliseconds: Int64) -> some View {
        VStack(spacing: 2) {
            Text(name)
                .font(.platform(.caption))
                .foregroundStyle(.textSecondary)
            Text(RecordingScreenText.preciseTime(milliseconds: milliseconds))
                .font(.platform(.footnote))
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func transport(playing: Bool) -> some View {
        let ready = player.isRecordingAudioReady
        return Transport(
            isPlaying: playing, size: .feature, sides: .edges, macLook: .glyphs,
            playName: RecordingScreenText.playSelection, canPlay: ready, canGoBack: ready, canGoForward: ready,
            onPlayPause: toggle, onBack: { model.select(.start) }, onForward: { model.select(.end) })
    }

    private func seek(_ ms: Double) {
        player.audio.seek(to: (ms - Double(model.bounds.lowerBound)) / 1000)
    }

    /// Plays from `ms` up to the end handle, where playback stops.
    private func play(from ms: Int64) {
        player.audio.seek(to: model.handleSeconds(ms))
        stop.arm()
        player.audio.play()
    }

    private func toggle() {
        if player.audio.isPlaying {
            stop.disarm()
            player.audio.pause()
        } else {
            play(from: model.start)
        }
    }

    private func follow(_ reading: PlayerReading) {
        let action = stop.observe(
            playing: reading.playing, elapsed: reading.elapsed, end: model.handleSeconds(model.end),
            length: player.audio.duration ?? 0)
        switch action {
        case .none:
            break
        case .stop(let at):
            player.audio.pause()
            player.audio.seek(to: at)
        case .park(let at):
            player.audio.seek(to: at)
        }
    }

    private var cancelButton: some View {
        Button(RecordingScreenText.cancel, action: leave)
    }

    private var saveButton: some View {
        EditorSaveButton(
            model: model, isDisabled: model.isSaving,
            confirmTitle: RecordingScreenText.trimConfirmTitle(milliseconds: model.length),
            confirmAction: RecordingScreenText.trimConfirmAction,
            confirmMessage: RecordingScreenText.trimConfirmMessage, failure: $failure,
            failureText: { _ in RecordingScreenText.trimNotSaved }, onLeave: leave, onDone: onDone)
    }

    private func leave() {
        stop.disarm()
        model.leave()
        onDone()
    }
}

/// Bars for `range` of the source with the kept range in range handles. The overview's handles
/// are what VoiceOver and the keyboard reach; the detail's repeat them for touch and the pointer
/// alone, so each handle is announced once. Tap or drag the bars to move the playhead there;
/// drag a handle to move it.
private struct TrimStrip: View {
    let model: TrimModel
    /// The stretch of the source shown, in ms.
    let range: ClosedRange<Double>
    /// Peaks from the start of `model.bounds`.
    let peaks: ShownPeaks?
    /// Read only by the playhead layer and the handles' lazy playhead, so the playback tick
    /// redraws the playhead alone.
    let player: PlayerModel
    let height: CGFloat
    /// The detail, whose window holds still under a handle dragged in it.
    let isDetail: Bool
    /// `ms` on the source timeline.
    let onSeek: (Double) -> Void

    /// Resets however the press ends, cancelled included.
    @GestureState private var seekPressed = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorScheme) private var colorScheme

    /// Room on each side for a tab, so a handle at either end of the recording shows it whole.
    private static let inset = RangeHandles.tabWidth
    /// The kept range takes the color Split gives its first piece.
    private static let color = SplitModel.State.pieceColor(0)

    var body: some View {
        GeometryReader { geometry in
            let width = max(0, geometry.size.width - Self.inset * 2)
            ZStack(alignment: .topLeading) {
                Canvas { context, size in
                    draw(in: &context, size: size)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                // Over the handles' dim, so the playhead reads at full strength outside the kept
                // range. Without a dim, it sits over the wash and under the handles.
                if !RangeHandles.drawsWash { playheadLayer }
                handles(width: width)
                if RangeHandles.drawsWash { playheadLayer }
            }
            .frame(width: width)
            .padding(.horizontal, Self.inset)
            // Spans the side margins too, so a press beside either end seeks to that end.
            .background {
                Color.clear
                    .contentShape(.rect)
                    .gesture(seek(width: width), including: isEnabled ? .all : .none)
            }
        }
        .frame(height: height)
        .opacity(isEnabled ? 1 : 0.5)
        .onChange(of: seekPressed) { _, pressed in
            if !pressed { model.endSeek() }
        }
    }

    /// The kept range's handles, in seconds from the start of `model.bounds`.
    private var playheadLayer: some View {
        TrimPlayhead(model: model, player: player, range: range)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func handles(width: CGFloat) -> some View {
        let low = Double(model.bounds.lowerBound)
        let span = range.upperBound - range.lowerBound
        let seconds = model.handleSeconds
        let sourceMs = { model.sourceMs(handleSeconds: $0) }
        return RangeHandles(
            start: seconds(model.start), end: seconds(model.end), duration: seconds(model.bounds.upperBound),
            color: Palette.loop(Self.color, scheme: colorScheme),
            wash: Palette.loopTint(Self.color, scheme: colorScheme),
            scale: { CGFloat(span > 0 ? (low + $0 * 1000 - range.lowerBound) / span : 0) * width },
            time: { (range.lowerBound + Double(width > 0 ? $0 / width : 0) * span - low) / 1000 },
            snapPoints: [], playhead: (TrimScreen.playheadMs(player, in: model) - low) / 1000,
            minimumLength: Double(RecordingLimits.minLengthMs) / 1000, movesSpan: false, isFocusable: !isDetail,
            valueText: { RecordingScreenText.preciseTime(milliseconds: sourceMs($0) - model.bounds.lowerBound) },
            // A handle's target reaches past its line, so a tap on it picks the nearer handle.
            onTap: { model.selectHandle(nearestMs: sourceMs($0)) },
            onFocus: { model.selectHandle(nearestMs: sourceMs($0)) },
            onKeyStep: { start, end in model.stepHandles(startMs: sourceMs(start), endMs: sourceMs(end)) },
            onChange: { start, end in
                model.moveHandles(startMs: sourceMs(start), endMs: sourceMs(end), holdsDetail: isDetail)
            },
            onCommit: { _, _ in model.commitHandles() }
        )
    }

    private func seek(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .updating($seekPressed) { _, pressed, _ in
                if !pressed { model.beginSeek() }
                pressed = true
            }
            .onEnded { value in
                defer { model.endSeek() }
                guard !model.seekCancelled else { return }
                onSeek(ms(at: value.location.x - Self.inset, width: width))
            }
    }

    private func ms(at x: CGFloat, width: CGFloat) -> Double {
        guard width > 0 else { return range.lowerBound }
        return range.lowerBound + Double(min(max(x / width, 0), 1)) * (range.upperBound - range.lowerBound)
    }

    private func fraction(_ ms: Double) -> CGFloat {
        TrimPlayhead.fraction(ms, in: range)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let low = Double(model.bounds.lowerBound)
        let levels =
            peaks?.sliced(fromMs: Int64(range.lowerBound - low), toMs: Int64((range.upperBound - low).rounded(.up)))
            .bars(PeakBars.count(in: size.width)) ?? []
        let bars = BarPath.peakBars(levels: levels, in: CGRect(origin: .zero, size: size))
        context.fill(bars, with: .color(Palette.accent))
        guard !RangeHandles.drawsWash else { return }
        let from = min(max(fraction(Double(model.start)) * size.width, 0), size.width)
        let to = min(max(fraction(Double(model.end)) * size.width, 0), size.width)
        if to > from {
            context.fill(
                Path(CGRect(x: from, y: 0, width: to - from, height: size.height)),
                with: .color(Palette.loopTint(Self.color, scheme: colorScheme)))
        }
    }
}

/// The playhead line over a strip of `range`. Its own view, so the playback tick redraws it and
/// not the bars and handles around it.
private struct TrimPlayhead: View {
    let model: TrimModel
    let player: PlayerModel
    let range: ClosedRange<Double>

    static func fraction(_ ms: Double, in range: ClosedRange<Double>) -> CGFloat {
        let span = range.upperBound - range.lowerBound
        return span > 0 ? CGFloat((ms - range.lowerBound) / span) : 0
    }

    var body: some View {
        let playhead = Self.fraction(TrimScreen.playheadMs(player, in: model), in: range)
        Canvas { context, size in
            guard (0...1).contains(playhead) else { return }
            let x = min(max(0, playhead * size.width - 1), size.width - 2)
            context.fillPlayhead(CGRect(x: x, y: 0, width: 2, height: size.height))
        }
    }
}
