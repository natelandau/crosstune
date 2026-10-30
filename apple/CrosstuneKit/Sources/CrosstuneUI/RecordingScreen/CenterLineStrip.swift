import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// What holds the keyboard on the Split screen: the screen itself, or cut `index`'s handle.
enum SplitFocus: Hashable {
    case screen
    case cut(Int)
}

/// The recording at one scale under a fixed center line, which is the time a new cut lands at.
/// A drag on the audio moves the line's time. Once there is a cut, each piece is a band in its
/// loop color, and each cut between two bands is a loop edge handle that drags, or with the
/// arrows and VoiceOver nudges, that cut alone. A tap on a band selects that piece. While audio
/// plays the bars scroll on their own and the line stays the play position. The line is the
/// adjustable element VoiceOver moves.
struct CenterLineStrip: View {
    let model: SplitModel
    /// Peaks from the start of `model.bounds`.
    let peaks: ShownPeaks?
    var focus: FocusState<SplitFocus?>.Binding

    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.practiceBackground) private var practiceScheme
    @GestureState private var isPinching = false
    @GestureState private var scrubPressed = false
    @GestureState private var handlePressed = false
    /// Whether the drag under way has begun scrubbing, so its first move holds playback.
    @State private var isScrubbing = false

    private static let height: CGFloat = 112
    private static let space = "centerLineStrip"
    /// The selected piece's bars along its top and bottom edges.
    private static let selectedBarHeight: Double = 6

    var body: some View {
        ZStack(alignment: .topLeading) {
            surface
            if let view = model.zoomedView(centerMs: model.shownLineMs) {
                ForEach(model.state.cuts.indices, id: \.self) { index in
                    handle(index, view: view)
                }
            }
        }
        .frame(height: Self.height)
        .coordinateSpace(.named(Self.space))
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
        .onChange(of: handlePressed) { _, pressed in
            if !pressed { model.cancelCutDrag() }
        }
        .task(id: model.autoPan != 0) {
            while model.autoPan != 0, !Task.isCancelled {
                model.autoPanStep()
                try? await Task.sleep(for: .milliseconds(16))
            }
        }
        #if os(iOS)
            .sensoryFeedback(.impact(weight: .light), trigger: model.cutSnaps)
        #endif
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityElement(children: .contain)
    }

    private var surface: some View {
        Canvas { context, size in
            draw(in: &context, size: size)
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

    private func handle(_ index: Int, view: ZoomedWaveformView) -> some View {
        LoopEdgeHandle(
            edge: .end, x: view.x(ofSourceMs: Double(model.state.cuts[index])), width: view.width,
            space: Self.space, snappedTo: model.cutDrag?.index == index ? model.cutDrag?.snappedTo : nil,
            focus: focus, focusValue: .cut(index), pressed: $handlePressed,
            label: RecordingScreenText.cutHandle(index + 1), valueText: model.cutValue(index),
            onTap: { model.tapPiece(atX: $0) },
            onDrag: { x, snapping in
                if model.cutDrag == nil { model.beginCutDrag(index) }
                model.dragCut(toX: x, snapping: snapping)
            },
            onDragEnd: { x, snapping in model.endCutDrag(atX: x, snapping: snapping) },
            onStep: { model.nudgeCut(index, by: $0) },
            onReveal: { model.reveal(model.state.cuts[index]) })
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        guard let view = model.zoomedView(centerMs: model.shownLineMs) else { return }
        let width = Double(size.width)
        let height = Double(size.height)
        context.fillZoomedBars(
            view: view, lengthMs: Double(model.bounds.upperBound - model.bounds.lowerBound), peaks: peaks, size: size,
            onPractice: practiceScheme != nil, placeholderOnMac: false)
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
            CGRect(x: width / 2 - 1, y: 0, width: 2, height: height), onPractice: practiceScheme != nil)
    }
}
