import CoreGraphics
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@Suite struct TuneFactsTests {
    private func detail(
        _ tune: Tune = Tune(createdAt: noon, title: "Test"), learnedFrom: String? = nil
    ) -> TuneDetail {
        TuneDetail(
            tune: tune,
            userTune: UserTune(createdAt: noon, tuneID: tune.id, status: "learning", learnedFrom: learnedFrom),
            instruments: ["violin"])
    }

    // MARK: Layout

    @Test func theRailNeedsRoomForItselfBesideAReadableColumn() {
        let threshold = PageStyle.factsRailWidth + PageStyle.contentMinWidth
        #expect(TuneFacts.layout(forDetailWidth: threshold - 1) == .card)
        #expect(TuneFacts.layout(forDetailWidth: threshold) == .rail)
        #expect(TuneFacts.layout(forDetailWidth: 0) == .card)
    }

    /// The iPad's detail column: whatever of the tab's width the content column leaves.
    private static func padDetail(_ tabWidth: CGFloat) -> CGFloat {
        tabWidth - PadStyle.contentColumnWidth(in: tabWidth)
    }

    #if os(macOS)
        /// The Mac's detail column beside the sidebar and content column at their ideal widths.
        private static func macDetail(_ windowWidth: CGFloat) -> CGFloat {
            windowWidth - SplitShell.sidebarIdealWidth - SplitShell.contentIdealWidth
        }

        @Test(
            arguments: [
                ("Mac 900", macDetail(900), FactsLayout.card),
                ("Mac 1400", macDetail(1400), .rail),
            ] as [(String, CGFloat, FactsLayout)])
        func theMacLayoutFollowsTheWindow(_ place: String, _ width: CGFloat, _ expected: FactsLayout) {
            #expect(TuneFacts.layout(forDetailWidth: width) == expected, "\(place) at \(width)")
        }
    #endif

    /// The layout follows the detail column's width, never the device: each case is a window
    /// width turned into the column the shell gives the page.
    @Test(
        arguments: [
            // iPad Pro 13-inch landscape and portrait, iPad Pro 11-inch landscape and portrait.
            ("iPad 13 landscape", padDetail(1376), FactsLayout.rail),
            ("iPad 13 portrait", padDetail(1032), .card),
            ("iPad 11 landscape", padDetail(1210), .rail),
            ("iPad 11 portrait", padDetail(834), .card),
            // Slide Over runs the phone shell at full width; Stage Manager resizes a split window.
            ("Slide Over", 320, .card),
            ("Stage Manager narrow", padDetail(1000), .card),
            ("Stage Manager wide", padDetail(1200), .rail),
            // The iPhone Duo's inner display (669 by 951) splits evenly; closed, it is a phone.
            ("Duo open portrait", padDetail(669), .card),
            ("Duo open landscape", padDetail(951), .card),
            ("Duo closed", 466, .card),
        ] as [(String, CGFloat, FactsLayout)])
    func theLayoutFollowsTheDetailColumn(_ place: String, _ width: CGFloat, _ expected: FactsLayout) {
        #expect(TuneFacts.layout(forDetailWidth: width) == expected, "\(place) at \(width)")
    }

    // MARK: Pinning

    @Test func theRailStaysPutUntilItsTopReachesThePin() {
        #expect(TuneFacts.pinOffset(top: 50, minY: 120, columnHeight: 1000, railHeight: 400) == 0)
        #expect(TuneFacts.pinOffset(top: 50, minY: 50, columnHeight: 1000, railHeight: 400) == 0)
    }

    @Test func thePinnedRailFollowsTheScroll() {
        #expect(TuneFacts.pinOffset(top: 50, minY: -100, columnHeight: 1000, railHeight: 400) == 150)
    }

    @Test func thePinnedRailStopsAtTheColumnsEnd() {
        #expect(TuneFacts.pinOffset(top: 50, minY: -900, columnHeight: 1000, railHeight: 400) == 600)
        #expect(TuneFacts.pinOffset(top: 50, minY: -900, columnHeight: 300, railHeight: 400) == 0)
    }

    // MARK: Open editor

    private typealias Key = FactsOpenState.Key

    @Test func onlyTheOpenedRowShowsItsEditor() {
        var state = FactsOpenState()
        let status = Key(tuneID: "a", layout: .rail, id: .status)
        state.set(status, shown: true)
        #expect(state.isPresented(status))
        #expect(!state.isPresented(Key(tuneID: "a", layout: .rail, id: .key)))
        #expect(!state.isPresented(Key(tuneID: "b", layout: .rail, id: .status)))
        #expect(!state.isPresented(Key(tuneID: "a", layout: .card, id: .status)))
    }

    @Test func anotherRowClosingLeavesTheOpenOneAlone() {
        var state = FactsOpenState()
        let status = Key(tuneID: "a", layout: .rail, id: .status)
        state.set(status, shown: true)
        state.set(Key(tuneID: "a", layout: .rail, id: .key), shown: false)
        #expect(state.isPresented(status))
        state.set(status, shown: false)
        #expect(!state.isPresented(status))
    }

    @Test func anotherTuneOrLayoutClosesTheEditor() {
        let status = Key(tuneID: "a", layout: .rail, id: .status)
        var swapped = FactsOpenState()
        swapped.set(status, shown: true)
        swapped.keep(tuneID: "b", layout: .rail)
        swapped.keep(tuneID: "a", layout: .rail)
        #expect(!swapped.isPresented(status), "a return to the tune never reopens it")

        var flipped = FactsOpenState()
        flipped.set(status, shown: true)
        flipped.keep(tuneID: "a", layout: .card)
        flipped.keep(tuneID: "a", layout: .rail)
        #expect(!flipped.isPresented(status))

        var same = FactsOpenState()
        same.set(status, shown: true)
        same.keep(tuneID: "a", layout: .rail)
        #expect(same.isPresented(status))
    }

    // MARK: Rows

    @Test func theRailGroupsTheFactsUnderDetailsAboutAndLearnedInOrder() {
        let rows = FactRows.rows(detail())
        let rail = TuneFacts.rail(rows)
        #expect(
            rail.details.map(\.id) == [
                .status, .key, .tuning("violin"), .tuneType, .timeSignature, .partStructure,
            ])
        #expect(rail.about.map(\.id) == [.genre, .composer, .alternateTitles])
        #expect(rail.learned.map(\.id) == [.learnedFrom, .learnedOn])
    }

    @Test func theRailGroupHeadingsMatchTheWebClient() {
        #expect(FactCopy.detailsGroup == "Details")
        #expect(FactCopy.aboutGroup == "About")
        #expect(FactCopy.learnedGroup == "Learned")
        #expect(FactCopy.listsGroup == "Lists")
    }

    @Test func anUnsetValueReadsAdd() {
        let rows = FactRows.rows(detail(learnedFrom: "Kevin Burke"))
        let type = rows.first { $0.id == .tuneType }!
        let from = rows.first { $0.id == .learnedFrom }!
        #expect(TuneFacts.value(type) == FactCopy.addValue)
        #expect(TuneFacts.value(from) == "Kevin Burke")
    }

    @Test func eachRowIsNamedForItsLabelAndValue() {
        let rows = FactRows.rows(detail())
        let status = rows.first { $0.id == .status }!
        let type = rows.first { $0.id == .tuneType }!
        #expect(TuneFacts.accessibilityLabel(status) == "Status, Learning")
        #expect(TuneFacts.accessibilityLabel(type) == "Type, Add")
    }

    @Test func theCardShowsTheMainFactsUntilMoreDetailsOpens() {
        let tune = Tune(createdAt: noon, title: "T", tuneType: "reel", partStructure: "AABB")
        let rows = FactRows.rows(detail(tune))
        let closed = TuneFacts.card(rows, expanded: false)
        #expect(closed.shown.map(\.id) == [.status, .key, .tuning("violin"), .tuneType])
        #expect(closed.shown.last?.text == "reel · AABB")
        #expect(closed.more.isEmpty)
        #expect(closed.learned.isEmpty)

        let open = TuneFacts.card(rows, expanded: true)
        #expect(open.shown == closed.shown)
        #expect(open.more.map(\.id) == [.timeSignature, .partStructure, .genre, .composer, .alternateTitles])
        #expect(open.learned.map(\.id) == [.learnedFrom, .learnedOn])
    }

    @Test func moreDetailsSaysWhetherItIsOpen() {
        #expect(TuneFacts.moreDetailsState(expanded: true) == FactCopy.expanded)
        #expect(TuneFacts.moreDetailsState(expanded: false) == FactCopy.collapsed)
    }

    // MARK: Tune identity

    /// A swap of the detail column's tune must tear the rows down, so an open editor ends as
    /// `.unmounted` and saves to the tune it opened for, through that tune's own model. Neither
    /// shows without a window, so the source is read.
    @Test func theRowsBelongToTheTuneTheyWriteTo() throws {
        let text = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.sources.appending(path: "Tune/TuneFacts.swift")))
        #expect(text.contains(".id(model.tuneID)"), "Key the facts to the model's tune")
        #expect(text.contains("write: model.write"), "Write through the tune's own model")
    }
}
