import SwiftUI

/// How the recording screen sizes its waveform. The waveform takes whatever height the screen
/// has left over the mode panels, which always reserve the tallest panel's height, so changing
/// mode, adding the first loop, or opening a name field never moves the controls the musician is
/// reaching for. Below its floor the waveform stops shrinking and the panels scroll instead.
enum PracticeLayout {
    /// The least height the waveform keeps, in points. A phone on its side has little height,
    /// so its floor is lower.
    static func waveformFloor(isCompactHeight: Bool) -> Double {
        isCompactHeight ? 64 : 140
    }

    /// The least side of a control's press target: a fingertip on iOS, a pointer on the Mac.
    #if os(macOS)
        static let target: CGFloat = 28
    #else
        static let target = minimumTapTarget
    #endif
}

extension View {
    /// Shows the view, or keeps its room with nothing there that can be seen, pressed, focused,
    /// or read.
    func reserved(shown: Bool) -> some View {
        opacity(shown ? 1 : 0)
            .allowsHitTesting(shown)
            .accessibilityHidden(!shown)
            .disabled(!shown)
    }
}
