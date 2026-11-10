import SwiftUI
import Testing

@testable import CrosstuneDesign

@Suite struct PaneTabsTests {
    private enum Mode: CaseIterable { case speed, pitch, isolate, loops }

    @Test func slidesTowardTheChosenSide() {
        let order = Mode.allCases
        #expect(PaneSlide.edge(from: Mode.speed, to: .loops, order: order) == .trailing)
        #expect(PaneSlide.edge(from: Mode.loops, to: .pitch, order: order) == .leading)
        #expect(PaneSlide.edge(from: Mode.pitch, to: .pitch, order: order) == nil)
    }

    @Test func hasNoEdgeWhenAValueIsMissingFromTheOrder() {
        let order: [Mode] = [.speed, .pitch]
        #expect(PaneSlide.edge(from: Mode.speed, to: .loops, order: order) == nil)
        #expect(PaneSlide.edge(from: Mode.loops, to: .pitch, order: order) == nil)
    }

    @Test func labelCarriesAValueOnlyWhenSet() {
        #expect(PaneTab<Mode>.label(title: "Speed", valueText: "75%") == "Speed 75%")
        #expect(PaneTab<Mode>.label(title: "Speed", valueText: nil) == "Speed")
    }

    /// On the Mac the tabs are one focus stop that VoiceOver reads as a tab bar.
    @Test func macTabsAreOneFocusStopReadAsATabBar() throws {
        let text = SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: "Mac/MacTabBar.swift")))
        for token in [".macFocusable()", ".isTabBar"] {
            #expect(text.contains(token), "MacTabBar is missing \(token)")
        }
        let tabs = SourceScan.macCompiled(
            SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: "Phone/Controls/PaneTabs.swift"))))
        #expect(tabs.contains("MacTabBar("))
    }
}
