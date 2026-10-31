import CrosstuneDesign
import CrosstuneStore
import SwiftUI

#if os(iOS)
    import GameController
#elseif os(macOS)
    import AppKit
#endif

/// A loop edge handle over a zoomed waveform: the mark, its 44 point target, and its drag,
/// keyboard focus, and VoiceOver adjustment. Practice's loop edges and Split's cuts both use it;
/// each owner keeps the rules for where its edge may go. `x` is the edge's place in the
/// waveform's coordinate space `space`, which is `width` wide.
struct LoopEdgeHandle<Focus: Hashable>: View {
    let edge: LoopModel.Edge
    let x: Double
    let width: Double
    let space: String
    /// The time the drag rests on a snap at, so only a jump onto or off a snap point eases.
    let snappedTo: Int64?
    var focus: FocusState<Focus?>.Binding
    let focusValue: Focus
    /// Reset however the drag ends, cancelled included; its owner watches it to let go.
    let pressed: GestureState<Bool>
    let label: String
    let valueText: String
    /// A tap on the target, at `x` in `space`, which is a tap on the waveform there.
    let onTap: (Double) -> Void
    /// The drag is now at `x` in `space`, snapping unless Option is held.
    let onDrag: (_ x: Double, _ snapping: Bool) -> Void
    let onDragEnd: (_ x: Double, _ snapping: Bool) -> Void
    /// One step of `deltaMs`, from VoiceOver.
    let onStep: (Int64) -> Void
    /// The handle took keyboard focus out of view.
    let onReveal: () -> Void

    var body: some View {
        let inView = x >= 0 && x <= width
        LoopHandleMark(edge: edge)
            .frame(width: PracticeModel.handleReach * 2)
            .frame(maxHeight: .infinity)
            .contentShape(.rect)
            .offset(x: min(max(x, 0), width) - PracticeModel.handleReach)
            // Keyed on the snap, so only a jump onto or off a snap point eases; a drag's own
            // moves and the waveform's scroll stay locked to the finger and the playhead.
            .phoneAnimation(.spring(duration: 0.3, bounce: 0.3), reduced: nil, value: snappedTo)
            .opacity(inView ? 1 : 0)
            .allowsHitTesting(inView)
            .onTapGesture(coordinateSpace: .named(space)) { location in
                onTap(Double(location.x))
            }
            .highPriorityGesture(
                DragGesture(minimumDistance: LoopModel.dragThreshold, coordinateSpace: .named(space))
                    .updating(pressed) { _, pressed, _ in pressed = true }
                    .onChanged { value in onDrag(Double(value.location.x), HandleSnapping.isOn) }
                    .onEnded { value in onDragEnd(Double(value.location.x), HandleSnapping.isOn) }
            )
            .focusable()
            .focused(focus, equals: focusValue)
            .onChange(of: focus.wrappedValue == focusValue) { _, focused in
                if focused, !inView { onReveal() }
            }
            .accessibilityElement()
            .accessibilityLabel(label)
            .accessibilityValue(valueText)
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: onStep(WaveformSteps.nudgeMs)
                case .decrement: onStep(-WaveformSteps.nudgeMs)
                @unknown default: break
                }
            }
            .accessibilityAction(named: PracticeText.laterBySecond) { onStep(WaveformSteps.largeNudgeMs) }
            .accessibilityAction(named: PracticeText.earlierBySecond) { onStep(-WaveformSteps.largeNudgeMs) }
    }
}

/// Whether a handle's drag snaps now: not while Option is held on a hardware keyboard.
enum HandleSnapping {
    @MainActor static var isOn: Bool {
        #if os(iOS)
            let keys = GCKeyboard.coalesced?.keyboardInput
            return ![GCKeyCode.leftAlt, .rightAlt].contains { keys?.button(forKeyCode: $0)?.isPressed == true }
        #else
            !NSEvent.modifierFlags.contains(.option)
        #endif
    }
}

/// A range handle, for a loop, a cut, or a trim: a line the height of the waveform with a grab
/// tab centered on it. The tab sits outside the range so it never covers the audio in it. Every
/// handle is brand, the one color for what marks a position, which leaves a loop's own color to
/// its band and tab.
struct LoopHandleMark: View {
    static let tabWidth: CGFloat = 16
    static let tabHeight: CGFloat = 44

    let edge: LoopModel.Edge

    var body: some View {
        ZStack {
            Rectangle()
                .fill(Palette.brand)
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
            .fill(Palette.brand)
            #if os(macOS)
                // A centered stroke shows its outer half, a point outside the tab.
                .background { shape.stroke(Color.markOutline, lineWidth: 2) }
            #endif
            .frame(width: Self.tabWidth, height: Self.tabHeight)
            .overlay {
                HStack(spacing: 2) {
                    ForEach(0..<2, id: \.self) { _ in
                        Capsule().fill(Palette.onPractice).frame(width: 1.5, height: 16)
                    }
                }
            }
    }
}
