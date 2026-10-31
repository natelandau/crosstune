import CrosstuneAudio
import CrosstuneCommands
import CrosstuneDesign
import SwiftUI

/// What holds the keyboard on the trim screen: the screen itself, or one of its handles.
enum TrimKeyboardFocus: Hashable {
    case screen
    case handle(TrimModel.Handle)
}

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
    @FocusState private var keyboard: TrimKeyboardFocus?

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
                }
                TrimStrip(
                    model: model, range: Double(model.bounds.lowerBound)...Double(model.bounds.upperBound),
                    peaks: peaks, player: player, height: 56, announced: true, keyboard: $keyboard,
                    onSeek: seek)
                TrimStrip(
                    model: model, range: model.detailWindow(), peaks: peaks, player: player, height: 96,
                    announced: false, keyboard: $keyboard, onSeek: seek
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
                zoomAndReadouts
                transport(playing: playing)
                Button(RecordingScreenText.previewEnd) {
                    play(from: max(model.start, model.end - TrimModel.previewMs))
                }
            }
            .disabled(!ready)
            .frame(maxWidth: 560)
            .padding(16)
            .frame(maxWidth: .infinity)
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
        .focused($keyboard, equals: .screen)
        .defaultFocus($keyboard, .screen)
        // These are off while text is typed, and a focused button keeps them.
        .onKeyPress(.space, phases: .down) { _ in
            guard ready, !TextEntry.isActive else { return .ignored }
            toggle()
            return .handled
        }
        // Held arrows repeat, sweeping the handle, as a slider does.
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
            guard ready, !TextEntry.isActive, press.modifiers.isDisjoint(with: .otherCommand) else {
                return .ignored
            }
            let step = press.modifiers.contains(.shift) ? WaveformSteps.largeNudgeMs : WaveformSteps.nudgeMs
            let back = press.key == .leftArrow || press.key == .downArrow
            model.nudge(model.focus, by: back ? -step : step)
            return .handled
        }
        .onChange(of: keyboard) { _, focused in
            if case .handle(let handle) = focused { model.select(handle) }
        }
        // The arrows nudge the handle the detail follows, so a focused handle's ring moves with
        // it however that changes: a drag, a Go to button, or a nudge.
        .onChange(of: model.focus) { _, handle in
            if case .handle = keyboard { keyboard = .handle(handle) }
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

    private var zoomAndReadouts: some View {
        ZoomButtons(canZoomOut: model.canZoomOut, canZoomIn: model.canZoomIn, onZoom: model.zoom(by:)) {
            readout(RecordingScreenText.startHandle, model.start - model.bounds.lowerBound)
            readout(RecordingScreenText.length, model.length)
            readout(RecordingScreenText.endHandle, model.end - model.bounds.lowerBound)
        }
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
        EditorTransport(playing: playing, playName: RecordingScreenText.playSelection, onToggle: toggle) {
            Button(RecordingScreenText.goToStart, systemImage: "arrow.left.to.line") { model.select(.start) }
                .help(RecordingScreenText.goToStart)
        } trailing: {
            Button(RecordingScreenText.goToEnd, systemImage: "arrow.right.to.line") { model.select(.end) }
                .help(RecordingScreenText.goToEnd)
        }
    }

    /// Seconds into the audio player's window for `ms` on the source timeline.
    private func seconds(_ ms: Int64) -> TimeInterval {
        TimeInterval(ms - model.bounds.lowerBound) / 1000
    }

    private func seek(_ ms: Double) {
        player.audio.seek(to: (ms - Double(model.bounds.lowerBound)) / 1000)
    }

    /// Plays from `ms` up to the end handle, where playback stops.
    private func play(from ms: Int64) {
        player.audio.seek(to: seconds(ms))
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
            playing: reading.playing, elapsed: reading.elapsed, end: seconds(model.end),
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
        @Bindable var model = model
        return Button(RecordingScreenText.save) { model.isConfirming = true }
            .disabled(!model.isChanged || model.isSaving)
            .coversShell(model.isConfirming)
            .confirmationDialog(
                RecordingScreenText.trimConfirmTitle(milliseconds: model.length),
                isPresented: $model.isConfirming, titleVisibility: .visible
            ) {
                Button(RecordingScreenText.trimConfirmAction, role: .destructive) { Task { await save() } }
                Button(RecordingScreenText.cancel, role: .cancel) {}
            } message: {
                Text(RecordingScreenText.trimConfirmMessage)
            }
    }

    private func leave() {
        stop.disarm()
        model.leave()
        onDone()
    }

    private func save() async {
        failure = nil
        do {
            if try await model.save() { onDone() }
        } catch CommandError.recordingNotFound {
            // The recording is gone, and the player and this screen go with it.
        } catch {
            // A trim from elsewhere takes the screen away, saying why, in place of this.
            if !model.isStale { failure = RecordingScreenText.trimNotSaved }
        }
    }
}

/// Bars for `range` of the source with the kept range tinted and a handle at each end of it. The
/// overview's handles are what VoiceOver and the keyboard reach; the detail's repeat them for
/// touch and the pointer alone, so each handle is announced once. Tap or drag the bars to move
/// the playhead there; drag a handle to move it.
private struct TrimStrip: View {
    let model: TrimModel
    /// The stretch of the source shown, in ms.
    let range: ClosedRange<Double>
    /// Peaks from the start of `model.bounds`.
    let peaks: ShownPeaks?
    /// Read in this strip's own body, so the playback tick redraws the strips alone.
    let player: PlayerModel
    let height: CGFloat
    let announced: Bool
    var keyboard: FocusState<TrimKeyboardFocus?>.Binding
    /// `ms` on the source timeline.
    let onSeek: (Double) -> Void

    /// The gesture under way. It resets however the gesture ends, cancelled included, so a
    /// drag always lets go of the stretch it held.
    @GestureState private var gesture: StripGesture?
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.practiceBackground) private var practiceScheme
    @Environment(\.colorScheme) private var colorScheme

    private struct StripGesture: Equatable {
        let handle: TrimModel.Handle?
        /// The stretch shown as the gesture began, held so the bars stay still under a dragged
        /// handle.
        let range: ClosedRange<Double>
    }

    /// A touch target around the line and its tab.
    private static let handleWidth = minimumTapTarget
    /// Room on each side for a tab, so a handle at either end of the recording shows it whole.
    private static let inset = LoopHandleMark.tabWidth
    /// The kept range takes the color Split gives its first piece.
    private static let color = SplitModel.State.pieceColor(0)

    var body: some View {
        let shown = gesture?.range ?? range
        let playheadMs = TrimScreen.playheadMs(player, in: model)
        GeometryReader { geometry in
            let width = max(0, geometry.size.width - Self.inset * 2)
            ZStack(alignment: .topLeading) {
                Canvas { context, size in
                    draw(in: &context, size: size, range: shown, playheadMs: playheadMs)
                }
                .accessibilityHidden(true)
                ForEach(TrimModel.Handle.allCases, id: \.self) { handle in
                    handleView(handle, range: shown, width: width)
                }
            }
            .frame(width: width)
            .padding(.horizontal, Self.inset)
            .contentShape(.rect)
            .gesture(drag(width: width), including: isEnabled ? .all : .none)
        }
        .frame(height: height)
        .opacity(isEnabled ? 1 : 0.5)
        .onChange(of: gesture == nil) { _, ended in
            if ended { model.endGesture() }
        }
    }

    @ViewBuilder
    private func handleView(_ handle: TrimModel.Handle, range: ClosedRange<Double>, width: CGFloat) -> some View {
        let raw = fraction(Double(model.value(handle)), in: range)
        // A handle being dragged stays on the strip, pinned to its edge, so its finger does.
        if gesture?.handle == handle || (0...1).contains(raw) {
            let mark = LoopHandleMark(edge: handle == .start ? .start : .end)
                .frame(width: Self.handleWidth, height: height)
                .contentShape(.rect)
                .position(x: min(max(raw, 0), 1) * width, y: height / 2)
            if announced {
                mark
                    .focusable()
                    .focused(keyboard, equals: .handle(handle))
                    .accessibilityElement()
                    .accessibilityLabel(
                        handle == .start ? RecordingScreenText.startHandle : RecordingScreenText.endHandle
                    )
                    .accessibilityValue(
                        RecordingScreenText.preciseTime(milliseconds: model.value(handle) - model.bounds.lowerBound)
                    )
                    .accessibilityAdjustableAction { direction in
                        switch direction {
                        case .increment: model.nudge(handle, by: WaveformSteps.nudgeMs)
                        case .decrement: model.nudge(handle, by: -WaveformSteps.nudgeMs)
                        @unknown default: break
                        }
                    }
            } else {
                mark
            }
        }
    }

    private func drag(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .updating($gesture) { value, state, _ in
                guard state == nil else { return }
                let handle = hit(value.startLocation.x - Self.inset, width: width)
                state = StripGesture(handle: handle, range: range)
                model.beginGesture(on: handle)
            }
            .onChanged { value in
                guard !model.gestureCancelled, let handle = model.gestureHandle else { return }
                model.drag(handle, to: ms(at: value.location.x - Self.inset, width: width))
            }
            .onEnded { value in
                defer { model.endGesture() }
                guard !model.gestureCancelled, model.gestureHandle == nil else { return }
                onSeek(ms(at: value.location.x - Self.inset, width: width))
            }
    }

    /// The handle within reach of `x`, the nearer when both are, and the focused one on a tie.
    private func hit(_ x: CGFloat, width: CGFloat) -> TrimModel.Handle? {
        let reach = TrimModel.Handle.allCases.compactMap { handle -> (handle: TrimModel.Handle, distance: CGFloat)? in
            let at = fraction(Double(model.value(handle)), in: range)
            guard (0...1).contains(at) else { return nil }
            let distance = abs(at * width - x)
            return distance <= Self.handleWidth / 2 ? (handle, distance) : nil
        }
        return reach.min {
            $0.distance != $1.distance ? $0.distance < $1.distance : $0.handle == model.focus
        }?.handle
    }

    private func ms(at x: CGFloat, width: CGFloat) -> Double {
        let held = gesture?.range ?? range
        guard width > 0 else { return held.lowerBound }
        return held.lowerBound + Double(min(max(x / width, 0), 1)) * (held.upperBound - held.lowerBound)
    }

    private func fraction(_ ms: Double, in range: ClosedRange<Double>) -> CGFloat {
        let span = range.upperBound - range.lowerBound
        return span > 0 ? CGFloat((ms - range.lowerBound) / span) : 0
    }

    private func draw(
        in context: inout GraphicsContext, size: CGSize, range: ClosedRange<Double>, playheadMs: Double
    ) {
        let low = Double(model.bounds.lowerBound)
        let startX = fraction(Double(model.start), in: range) * size.width
        let endX = fraction(Double(model.end), in: range) * size.width
        let levels =
            peaks?.sliced(fromMs: Int64(range.lowerBound - low), toMs: Int64((range.upperBound - low).rounded(.up)))
            .bars(PeakBars.count(in: size.width)) ?? []
        let bars = BarPath.peakBars(levels: levels, in: CGRect(origin: .zero, size: size))
        context.fill(bars, with: .style(.tint))
        let from = min(max(startX, 0), size.width)
        let to = min(max(endX, 0), size.width)
        if to > from {
            context.fill(
                Path(CGRect(x: from, y: 0, width: to - from, height: size.height)),
                with: .color(Palette.loopTint(Self.color, scheme: colorScheme)))
        }
        let playhead = fraction(playheadMs, in: range)
        if (0...1).contains(playhead) {
            let x = min(max(0, playhead * size.width - 1), size.width - 2)
            context.fillPlayhead(CGRect(x: x, y: 0, width: 2, height: size.height), onPractice: practiceScheme != nil)
        }
    }
}
