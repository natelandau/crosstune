import CrosstuneDesign
import SwiftUI

/// Closing the practice screen with a swipe down. The swipe starts with the page scrolled to its
/// top, as a sheet's does, so a swipe down on a scrolled page scrolls it back. It starts in the
/// header or the waveform, never in the controls under them, and it runs mostly straight down,
/// so the waveform's sideways scrub never closes the screen.
enum PracticeSwipe {
    /// The screen's coordinate space, in which the drag and the controls' top are measured.
    static let space = "practiceScreen"
    static let closeDistance: CGFloat = 120

    /// Whether a drag from `startY` that moved by `translation` closes the screen, where
    /// `areaBottom` is the top of the controls, or nil before they are laid out, and
    /// `startedAtTop` is whether the page was scrolled to its top when the drag began.
    static func closes(startY: CGFloat, translation: CGSize, areaBottom: CGFloat?, startedAtTop: Bool) -> Bool {
        guard startedAtTop, translation.height > closeDistance, translation.height > 2 * abs(translation.width)
        else {
            return false
        }
        guard let areaBottom else { return true }
        return startY < areaBottom
    }
}

extension View {
    /// Closes the practice screen on a swipe down from its header or waveform, where the
    /// platform closes it that way. `areaBottom` is the top of the controls, `isScrolledToTop`
    /// whether the page is at its top, and `isEnabled` is false while another screen is pushed
    /// over the practice one.
    func closesPracticeBySwipe(
        areaBottom: CGFloat?, isScrolledToTop: Bool, isEnabled: Bool, close: @escaping () -> Void
    ) -> some View {
        modifier(
            PracticeSwipeDown(
                areaBottom: areaBottom, isScrolledToTop: isScrolledToTop, isEnabled: isEnabled, close: close))
    }
}

private struct PracticeSwipeDown: ViewModifier {
    let areaBottom: CGFloat?
    let isScrolledToTop: Bool
    let isEnabled: Bool
    let close: () -> Void

    @GestureState private var isDragging = false
    /// Whether the page was at its top when the current drag began. Read at the start, because
    /// the drag itself scrolls the page back to the top.
    @State private var startedAtTop = true

    func body(content: Content) -> some View {
        if PageStyle.practiceClosesBySwipe {
            content
                .simultaneousGesture(swipe, isEnabled: isEnabled)
                .onChange(of: isDragging) { _, dragging in
                    if dragging { startedAtTop = isScrolledToTop }
                }
                .coordinateSpace(.named(PracticeSwipe.space))
        } else {
            content
        }
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 30, coordinateSpace: .named(PracticeSwipe.space))
            .updating($isDragging) { _, dragging, _ in dragging = true }
            .onEnded { value in
                if PracticeSwipe.closes(
                    startY: value.startLocation.y, translation: value.translation, areaBottom: areaBottom,
                    startedAtTop: startedAtTop)
                {
                    close()
                }
            }
    }
}
