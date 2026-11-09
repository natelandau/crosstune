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
}
