import SwiftUI

/// Closing the practice screen with a swipe down. The swipe starts in the header or the
/// waveform, never in the controls under them, which scroll, and it runs mostly straight down,
/// so the waveform's sideways scrub never closes the screen.
enum PracticeSwipe {
    /// The screen's coordinate space, in which the drag and the controls' top are measured.
    static let space = "practiceScreen"
    static let closeDistance: CGFloat = 120

    /// Whether a drag from `startY` that moved by `translation` closes the screen, where
    /// `areaBottom` is the top of the controls, or nil before they are laid out.
    static func closes(startY: CGFloat, translation: CGSize, areaBottom: CGFloat?) -> Bool {
        guard translation.height > closeDistance, translation.height > 2 * abs(translation.width) else {
            return false
        }
        guard let areaBottom else { return true }
        return startY < areaBottom
    }
}

extension View {
    /// Closes the practice screen on a swipe down from its header or waveform, where the
    /// platform closes it that way. `areaBottom` is the top of the controls, and `isEnabled`
    /// is false while another screen is pushed over the practice one.
    func closesPracticeBySwipe(areaBottom: CGFloat?, isEnabled: Bool, close: @escaping () -> Void) -> some View {
        modifier(PracticeSwipeDown(areaBottom: areaBottom, isEnabled: isEnabled, close: close))
    }
}

private struct PracticeSwipeDown: ViewModifier {
    let areaBottom: CGFloat?
    let isEnabled: Bool
    let close: () -> Void

    func body(content: Content) -> some View {
        if PageStyle.practiceClosesBySwipe {
            content
                .simultaneousGesture(swipe, isEnabled: isEnabled)
                .coordinateSpace(.named(PracticeSwipe.space))
        } else {
            content
        }
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 30, coordinateSpace: .named(PracticeSwipe.space))
            .onEnded { value in
                if PracticeSwipe.closes(
                    startY: value.startLocation.y, translation: value.translation, areaBottom: areaBottom)
                {
                    close()
                }
            }
    }
}
