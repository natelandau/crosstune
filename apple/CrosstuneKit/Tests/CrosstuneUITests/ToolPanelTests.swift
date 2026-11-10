import CrosstuneDesign
import SwiftUI
import Testing

@Suite struct ToolPanelTests {
    enum Tool: Hashable { case speed, pitch }

    /// Choosing a tool opens it and closes any other; choosing the open tool closes it.
    @Test(
        arguments: [
            (nil, Tool.speed, Tool.speed),
            (.speed, .pitch, .pitch),
            (.pitch, .pitch, nil),
        ] as [(Tool?, Tool, Tool?)])
    func oneToolOpensAtATime(current: Tool?, toggling: Tool, expected: Tool?) {
        #expect(ToolPanel<Tool, EmptyView, EmptyView>.open(current, toggling: toggling) == expected)
    }

    /// Practice going unavailable closes an open tool; staying available keeps it open.
    @Test func closesWhenUnavailable() {
        #expect(ToolPanel<Tool, EmptyView, EmptyView>.openAfter(availability: false, open: .speed) == nil)
        #expect(ToolPanel<Tool, EmptyView, EmptyView>.openAfter(availability: true, open: .speed) == .speed)
    }

    /// Practice going unavailable disables every tool, so focus on one, or in its popover, moves
    /// out of the tools; otherwise focus stays where it is.
    @Test(
        arguments: [
            (false, Tool.speed, nil, true),
            (false, nil, Tool.pitch, true),
            (false, nil, nil, false),
            (true, Tool.speed, Tool.speed, false),
        ] as [(Bool, Tool?, Tool?, Bool)])
    func focusLeavesDisabledTools(availability: Bool, open: Tool?, focused: Tool?, leaves: Bool) {
        #expect(
            ToolPanel<Tool, EmptyView, EmptyView>.focusLeaves(availability: availability, open: open, focused: focused)
                == leaves)
    }

    /// Focus returns to the tool Escape closed only once its popover is off screen and the window
    /// holds the keyboard again.
    @Test(
        arguments: [
            (Tool.speed, nil, true, Tool.speed),
            (.speed, .speed, true, nil),
            (.speed, nil, false, nil),
            (nil, nil, true, nil),
        ] as [(Tool?, Tool?, Bool, Tool?)])
    func focusReturnsOnceThePopoverHasGone(pending: Tool?, shown: Tool?, windowIsKey: Bool, expected: Tool?) {
        #expect(
            ToolPanel<Tool, EmptyView, EmptyView>.focusReturn(
                pending: pending, popoverShown: shown, windowIsKey: windowIsKey) == expected)
    }

    /// A popover that goes after the next one came on leaves the next one on screen.
    @Test(
        arguments: [
            (nil, Tool.speed, true, Tool.speed),
            (.speed, .speed, false, nil),
            (.pitch, .speed, false, .pitch),
        ] as [(Tool?, Tool, Bool, Tool?)])
    func tracksThePopoverOnScreen(current: Tool?, tool: Tool, shows: Bool, expected: Tool?) {
        #expect(ToolPanel<Tool, EmptyView, EmptyView>.popoverShown(current, tool: tool, shows: shows) == expected)
    }

    #if os(macOS)
        /// A tool's spoken name carries its value, as its label shows it.
        @Test(arguments: [("75%", "Speed, 75%"), (nil, "Speed")] as [(String?, String)])
        func toolNamesItsValue(value: String?, expected: String) {
            #expect(MacToolButton<EmptyView>.accessibilityName(title: "Speed", value: value) == expected)
        }

        /// A value off its default takes the accent, so a changed tool stands out from the rest.
        @Test func aChangedToolTakesTheAccent() {
            #expect(MacToolButton<EmptyView>.valueToken(isChanged: true) == .accent)
            #expect(MacToolButton<EmptyView>.valueToken(isChanged: false) == .textSecondary)
        }
    #endif
}
