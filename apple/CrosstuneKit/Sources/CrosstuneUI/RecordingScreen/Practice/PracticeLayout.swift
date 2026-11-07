import CrosstuneDesign
import SwiftUI

/// How the recording screen sizes its waveform. The waveform takes the height the screen has left
/// over the mode panels, up to ``waveformCap``, and the page below it keeps the rest. The mode
/// panels always reserve the tallest panel's height, so changing mode, adding the first loop, or
/// opening a name field never moves the controls the musician is reaching for. Below its floor the
/// waveform stops shrinking and the whole page scrolls instead.
enum PracticeLayout {
    /// The least height the waveform keeps, in points. A phone on its side has little height,
    /// so its floor is lower.
    static func waveformFloor(isCompactHeight: Bool) -> Double {
        isCompactHeight ? 64 : 140
    }

    /// The most height the waveform and its time ruler take together, in points. Matches the
    /// desktop web waveform's height; a taller window leaves the extra to the page around it.
    static let waveformCap: Double = 160

    /// The waveform's height given the height the window has beyond the page's other content and
    /// the waveform's floor: the floor plus that spare height, never past the cap.
    static func waveformHeight(spare: Double?, isCompactHeight: Bool) -> Double {
        let floor = waveformFloor(isCompactHeight: isCompactHeight)
        return min(max(floor, waveformCap), floor + max(0, spare ?? 0))
    }

    /// The least side of a control's press target: a fingertip on iOS, a pointer on the Mac.
    #if os(macOS)
        static let target: CGFloat = 28
    #else
        static let target = minimumTapTarget
    #endif

    /// The widest a player screen's controls grow, at the default text size. Matches the web's
    /// rem-based cap, so it grows with the text.
    static let controlsMaxWidth: CGFloat = 576
}

/// Holds a group of controls to ``PracticeLayout/controlsMaxWidth``, scaled with the text size
/// and centered, so on a wide window they stay near what they act on while a waveform above them
/// takes the full width. A phone on its side keeps the full width: its height is scarce, and
/// narrower controls wrap taller.
private struct ControlsColumn: ViewModifier {
    @ScaledMetric(relativeTo: .body) private var maxWidth = PracticeLayout.controlsMaxWidth
    #if os(iOS)
        @Environment(\.verticalSizeClass) private var verticalSizeClass
    #endif

    private var cap: CGFloat {
        #if os(iOS)
            if verticalSizeClass == .compact { return .infinity }
        #endif
        return maxWidth
    }

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: cap)
            .frame(maxWidth: .infinity)
    }
}

extension View {
    /// Holds a group of controls in the centered controls column.
    func controlsColumn() -> some View {
        modifier(ControlsColumn())
    }

    /// Shows the view, or keeps its room with nothing there that can be seen, pressed, focused,
    /// or read.
    func reserved(shown: Bool) -> some View {
        opacity(shown ? 1 : 0)
            .allowsHitTesting(shown)
            .accessibilityHidden(!shown)
            .disabled(!shown)
    }
}
