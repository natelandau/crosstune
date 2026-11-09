import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// The recording at one scale under a fixed center line, which is the time a new cut lands at.
/// A drag on the audio moves the line's time. Once there is a cut, each piece is a band in its
/// loop color, and each cut between two bands is a range handle's end edge that drags, or with
/// the arrows and VoiceOver steps, that cut alone. A tap on a band selects that piece. While audio
/// plays the bars scroll on their own and the line stays the play position. The line is the
/// adjustable element VoiceOver moves.
struct CenterLineStrip: View {
    let model: SplitModel
    /// Peaks from the start of `model.bounds`.
    let peaks: ShownPeaks?

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorScheme) private var colorScheme
    @GestureState private var isPinching = false
    @GestureState private var scrubPressed = false
    /// Whether the drag under way has begun scrubbing, so its first move holds playback.
    @State private var isScrubbing = false

    private static let height: CGFloat = 112
    /// The selected piece's bars along its top and bottom edges.
    private static let selectedBarHeight: Double = 6

    var body: some View {
        let view = model.zoomedView(centerMs: model.shownLineMs)
        ZStack(alignment: .topLeading) {
            surface(view)
            if let view {
                ForEach(model.state.identifiedCuts.enumerated(), id: \.element.id) { index, _ in
                    handle(index, view: view)
                }
            }
        }
        .frame(height: Self.height)
        .onGeometryChange(for: Double.self) {
            Double($0.size.width)
        } action: {
            model.width = $0
        }
        .simultaneousGesture(
            MagnifyGesture()
                .updating($isPinching) { _, pinching, _ in pinching = true }
                .onChanged { model.pinch($0.magnification) },
            including: isEnabled ? .all : .none
        )
        #if os(macOS)
            .background { ControlScrollZoom(isEnabled: isEnabled) { factor, _ in model.zoom(by: factor) } }
            .background {
                // A Control scroll is a zoom, and a mostly vertical scroll belongs to the page.
                ScrollWheelMonitor(isEnabled: isEnabled) { wheel in
                    guard !wheel.control, abs(wheel.deltaX) > abs(wheel.deltaY) else { return false }
                    if let pointsPerSecond = model.pointsPerSecond {
                        // Scrolling the audio left moves the line later.
                        model.scrub(byScrollMs: Int64((-wheel.deltaX / pointsPerSecond * 1000).rounded()))
                    }
                    return true
                }
            }
        #endif
        .onChange(of: isPinching) { _, pinching in
            if !pinching { model.endPinch() }
        }
        // A drag the system takes away never reaches `onEnded`.
        .onChange(of: scrubPressed) { _, pressed in
            if !pressed { endScrub() }
        }
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityElement(children: .contain)
    }

    private func surface(_ view: ZoomedWaveformView?) -> some View {
        Canvas { context, size in
            if let view { draw(in: &context, size: size, view: view) }
        }
        .contentShape(.rect)
        .onTapGesture { location in
            if isEnabled { model.tapPiece(atX: Double(location.x)) }
        }
        .simultaneousGesture(scrub, including: isEnabled ? .all : .none)
        .accessibilityElement()
        .accessibilityLabel(PracticeText.waveform)
        .accessibilityValue(RecordingScreenText.preciseTime(milliseconds: model.shownLineMs - model.bounds.lowerBound))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: model.nudge(by: WaveformSteps.nudgeMs)
            case .decrement: model.nudge(by: -WaveformSteps.nudgeMs)
            @unknown default: break
            }
        }
    }

    private var scrub: some Gesture {
        DragGesture(minimumDistance: LoopModel.dragThreshold)
            .updating($scrubPressed) { _, pressed, _ in pressed = true }
            .onChanged { value in
                guard let pointsPerSecond = model.pointsPerSecond else { return }
                if !isScrubbing {
                    isScrubbing = true
                    model.beginScrub()
                }
                // Dragging the audio left moves the line later.
                model.scrub(byMs: Int64((-Double(value.translation.width) / pointsPerSecond * 1000).rounded()))
            }
            .onEnded { _ in endScrub() }
    }

    private func endScrub() {
        guard isScrubbing else { return }
        isScrubbing = false
        model.endScrub()
    }

    /// Cut `index` as a range handle's end edge, in seconds from the start of `model.bounds`,
    /// held inside the room that keeps both pieces beside it long enough.
    private func handle(_ index: Int, view: ZoomedWaveformView) -> some View {
        let low = model.bounds.lowerBound
        let seconds = model.handleSeconds
        let sourceMs = { model.sourceMs(handleSeconds: $0) }
        let room = model.state.cutRoom(for: index)
        let color = SplitModel.State.pieceColor(index)
        return RangeHandles(
            start: seconds(room.min), end: seconds(model.state.cuts[index]), duration: seconds(room.max),
            color: Palette.loop(color, scheme: colorScheme), wash: Palette.loopTint(color, scheme: colorScheme),
            scale: { CGFloat(view.x(ofSourceMs: Double(low) + $0 * 1000)) },
            time: { (view.sourceMs(atX: Double($0)) - Double(low)) / 1000 },
            snapPoints: [seconds(room.min), seconds(room.max)], playhead: seconds(model.shownLineMs),
            minimumLength: 0, movesSpan: false, edges: .endOnly,
            endLabel: RecordingScreenText.cutHandle(index + 1),
            valueText: { RecordingScreenText.preciseTime(milliseconds: sourceMs($0) - low) },
            onEdgeScroll: { model.scrollUnderCutHandle(depth: $0) },
            // The target reaches past the cut, so a tap on it is a tap on the waveform.
            onTap: { model.tapPiece(atMs: sourceMs($0)) },
            onReveal: { model.reveal(sourceMs($0)) },
            onChange: { _, end in model.moveCutHandle(index, to: sourceMs(end)) },
            onCommit: { _, _ in model.commitCutHandle() }
        )
    }

    private func draw(in context: inout GraphicsContext, size: CGSize, view: ZoomedWaveformView) {
        let width = Double(size.width)
        let height = Double(size.height)
        context.fillZoomedBars(
            view: view, lengthMs: Double(model.bounds.upperBound - model.bounds.lowerBound), peaks: peaks, size: size,
            placeholderOnMac: false)
        // One piece is the whole recording, which needs no tint.
        if !model.state.cuts.isEmpty {
            let selected = model.selectedPiece
            for (index, piece) in model.state.pieces.enumerated() {
                let start = max(0, view.x(ofSourceMs: Double(piece.startMs)))
                let end = min(width, view.x(ofSourceMs: Double(piece.endMs)))
                guard end > start else { continue }
                let color = SplitModel.State.pieceColor(index)
                let isSelected = index == selected
                let tint =
                    isSelected
                    ? Palette.loopTint(color, scheme: colorScheme)
                    : Palette.loopTintUnselected(color, scheme: colorScheme)
                context.fill(Path(CGRect(x: start, y: 0, width: end - start, height: height)), with: .color(tint))
                if isSelected {
                    let bar = Self.selectedBarHeight
                    let loop = GraphicsContext.Shading.color(Palette.loop(color, scheme: colorScheme))
                    context.fill(Path(CGRect(x: start, y: 0, width: end - start, height: bar)), with: loop)
                    context.fill(Path(CGRect(x: start, y: height - bar, width: end - start, height: bar)), with: loop)
                }
            }
        }
        context.fillPlayhead(
            CGRect(x: width / 2 - 1, y: 0, width: 2, height: height))
    }
}
