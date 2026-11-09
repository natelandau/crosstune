import SwiftUI

/// A recording's position as a thumbless track with the time played and the time left under
/// it. The track is 6 pt tall and grows to 12 pt while touched. A drag is relative, so touching
/// never moves playback, and sliding the finger down while dragging slows the scrub. It is one
/// adjustable element whose steps are 5 seconds, and a focus stop whose arrow keys step.
/// `onScrub` reports each position a drag reaches and `onScrubEnd` where it was let go; a drag
/// the system cancels reports where it began through both.
package struct PlaybackScrubber: View {
    private let position: Double
    private let duration: Double
    private let name: String
    private let timesBeside: Bool
    private let onScrub: (Double) -> Void
    private let onScrubEnd: (Double) -> Void

    /// How far an arrow key or a VoiceOver swipe moves the position.
    nonisolated package static let keyStep: Double = 5
    nonisolated package static let defaultName = "Position"

    /// - Parameters:
    ///   - duration: The recording's length; 0 while it is unknown, which disables the track and
    ///     leaves out the time left.
    ///   - name: What VoiceOver calls the scrubber.
    ///   - timesBeside: Sets the times either side of the track on one line, as the Mac dock
    ///     lays them out, rather than under it.
    package init(
        position: Double, duration: Double, name: String = PlaybackScrubber.defaultName, timesBeside: Bool = false,
        onScrub: @escaping (Double) -> Void, onScrubEnd: @escaping (Double) -> Void
    ) {
        self.position = position
        self.duration = duration
        self.name = name
        self.timesBeside = timesBeside
        self.onScrub = onScrub
        self.onScrubEnd = onScrubEnd
    }

    @GestureState private var isDown = false
    @State private var origin: Double?
    #if !os(macOS)
        @State private var tracker: ScrubDrag.Tracker?
    #endif
    @State private var trackWidth: CGFloat = 0
    @FocusState private var focused: Bool
    @Environment(\.isEnabled) private var isEnabled

    private var isActive: Bool { isDown && isEnabled }
    /// Whether arrows and VoiceOver can step: enabled, with a known length to step within.
    private var canStep: Bool { isEnabled && duration > 0 }

    package var body: some View {
        focusableLayout
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(name)
            .accessibilityValue(
                duration > 0
                    ? "\(ScrubDrag.clockText(position)) of \(ScrubDrag.clockText(duration))"
                    : ScrubDrag.clockText(position)
            )
            .accessibilityAdjustableAction { direction in
                guard canStep else { return }
                switch direction {
                case .increment: step(Self.keyStep)
                case .decrement: step(-Self.keyStep)
                @unknown default: break
                }
            }
            .onChange(of: isDown) { _, down in
                // A cancelled touch never reaches `onEnded`, so the origin is still held here.
                if !down { cancelDrag() }
            }
            .onDisappear { cancelDrag() }
    }

    /// The Mac's focus ring circles the track alone, as a slider's does; iPhone and iPad draw
    /// their own ring around the whole scrubber.
    @ViewBuilder private var focusableLayout: some View {
        #if os(macOS)
            layout
        #else
            keyHandling(layout)
                .libraryFocusRing(focused, shape: RoundedRectangle(cornerRadius: 4))
        #endif
    }

    private func keyHandling(_ content: some View) -> some View {
        content
            .focusable(canStep, interactions: .activate)
            .focused($focused)
            #if !os(macOS)
                .focusEffectDisabled()
            #endif
            .onKeyPress(.leftArrow) { arrow(-1) }
            .onKeyPress(.rightArrow) { arrow(1) }
    }

    @ViewBuilder private var layout: some View {
        if timesBeside {
            HStack(spacing: 8) {
                times(elapsed)
                track
                times(remaining)
            }
        } else {
            VStack(spacing: 2) {
                track
                HStack {
                    elapsed
                    Spacer()
                    remaining
                }
                .modifier(TimesStyle(isActive: isActive))
            }
        }
    }

    private func times(_ text: some View) -> some View {
        text.modifier(TimesStyle(isActive: isActive))
    }

    private var elapsed: Text { Text(ScrubDrag.clockText(position)) }

    private var remaining: Text {
        guard duration > 0 else { return Text(verbatim: "") }
        #if os(macOS)
            return Text("-" + ScrubDrag.clockText(max(0, duration - position).rounded(.up)))
        #else
            return Text(ScrubDrag.remainingText(position, duration: duration))
        #endif
    }

    private var fraction: Double { duration > 0 ? min(max(position / duration, 0), 1) : 0 }

    @ViewBuilder private var track: some View {
        #if os(macOS)
            keyHandling(trackBar)
        #else
            trackBar
        #endif
    }

    private var trackBar: some View {
        ZStack(alignment: .leading) {
            #if os(macOS)
                MacScrubberBar(fraction: fraction, isDragging: isActive)
            #else
                Capsule().fill(Palette.borderStrong)
                Capsule().fill(Palette.accentTrack)
                    .frame(width: trackWidth * fraction)
            #endif
        }
        #if os(macOS)
            .frame(height: MacScrubberBar.height)
        #else
            .frame(height: isActive ? 12 : 6)
            .phoneAnimation(Motion.spring, value: isActive)
            .frame(height: 12)
        #endif
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.width
        } action: {
            trackWidth = $0
        }
        #if os(macOS)
            .contentShape(.rect)
            .gesture(drag)
        #else
            // A taller press area than the drawn track, so a finger finds it.
            .hitOutset(.vertical, by: 16)
            .gesture(drag)
        #endif
        .disabled(duration <= 0)
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 0)
            .updating($isDown) { _, state, _ in state = true }
            .onChanged { value in
                #if os(macOS)
                    origin = origin ?? position
                    onScrub(pointerPosition(value.location.x))
                #else
                    origin = origin ?? position
                    var current = tracker ?? ScrubDrag.Tracker(start: position)
                    onScrub(
                        current.move(
                            dx: value.translation.width, dy: value.translation.height, width: trackWidth,
                            duration: duration))
                    tracker = current
                #endif
            }
            .onEnded { value in
                #if os(macOS)
                    let end = pointerPosition(value.location.x)
                #else
                    var current = tracker ?? ScrubDrag.Tracker(start: position)
                    let end = current.move(
                        dx: value.translation.width, dy: value.translation.height, width: trackWidth,
                        duration: duration)
                #endif
                endDrag()
                onScrubEnd(end)
            }
    }

    #if os(macOS)
        private func pointerPosition(_ x: CGFloat) -> Double {
            trackWidth > 0 ? Double(min(max(x / trackWidth, 0), 1)) * duration : 0
        }
    #endif

    /// Puts a drag the system cancelled, or one whose view went away, back where it began.
    private func cancelDrag() {
        guard let origin else { return }
        endDrag()
        onScrub(origin)
        onScrubEnd(origin)
    }

    private func endDrag() {
        origin = nil
        #if !os(macOS)
            tracker = nil
        #endif
    }

    private func arrow(_ direction: Double) -> KeyPress.Result {
        guard focused, canStep else { return .ignored }
        step(direction * Self.keyStep)
        return .handled
    }

    private func step(_ seconds: Double) {
        guard let next = ScrubDrag.keyStepped(position, by: seconds, duration: duration) else { return }
        onScrub(next)
        onScrubEnd(next)
    }
}

/// The scrubber's times: tabular, so they hold still as they count. On iPhone and iPad they are
/// caption semibold and brighten while dragged; the Mac's are its caption in secondary text.
private struct TimesStyle: ViewModifier {
    let isActive: Bool

    func body(content: Content) -> some View {
        #if os(macOS)
            content
                .font(.platform(.caption))
                .monospacedDigit()
                .foregroundStyle(.textSecondary)
                .accessibilityHidden(true)
        #else
            content
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(isActive ? Palette.textPrimary : Palette.textSecondary)
                .phoneAnimation(Motion.state, value: isActive)
                .accessibilityHidden(true)
        #endif
    }
}

#if os(macOS)
    /// The Mac scrubber's track: a hairline filled in the tertiary text color to the position, with
    /// a brand-color playhead that grows under the pointer and while dragged.
    private struct MacScrubberBar: View {
        /// Taller than the line, so a pointer grabs it without aiming at three points.
        static let height: CGFloat = 20

        let fraction: Double
        let isDragging: Bool
        @State private var hovering = false

        var body: some View {
            GeometryReader { proxy in
                let width = proxy.size.width
                let thumb: CGFloat = hovering || isDragging ? 12 : 9
                let x = width * fraction
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.border).frame(height: 3)
                    Capsule().fill(Palette.textTertiary).frame(width: x, height: 3)
                    Circle().fill(Palette.playhead).frame(width: thumb, height: thumb)
                        .offset(x: min(max(0, x - thumb / 2), width - thumb))
                }
                .frame(maxHeight: .infinity)
                .onHover { hovering = $0 }
            }
        }
    }
#endif

#Preview("Scrubber") {
    @Previewable @State var position = 42.0
    PlaybackScrubber(
        position: position, duration: 195, onScrub: { position = $0 }, onScrubEnd: { position = $0 }
    )
    .padding()
}
