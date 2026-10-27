import CoreGraphics
import CrosstuneDesign
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@Suite struct TuneAttributesTests {
    private func detail(
        _ tune: Tune = Tune(createdAt: noon, title: "Test"), learnedFrom: String? = nil
    ) -> TuneDetail {
        TuneDetail(
            tune: tune,
            userTune: UserTune(createdAt: noon, tuneID: tune.id, status: "learning", learnedFrom: learnedFrom),
            instruments: ["violin"])
    }

    // MARK: Layout

    @Test func theColumnNeedsRoomForItselfBesideAReadableColumn() {
        let threshold = PageStyle.attributesColumnWidth + PageStyle.attributesColumnGap + PageStyle.contentMinWidth
        #expect(TuneAttributes.layout(forDetailWidth: threshold - 1) == .card)
        #expect(TuneAttributes.layout(forDetailWidth: threshold) == .column)
        #expect(TuneAttributes.layout(forDetailWidth: 0) == .card)
    }

    @Test func aWideColumnSetsEachValueBesideItsLabel() {
        let beside = PageStyle.attributesColumnBesideWidth
        #expect(TuneAttributes.arrangement(forColumnWidth: PageStyle.attributesColumnWidth) == .stacked)
        #expect(TuneAttributes.arrangement(forColumnWidth: beside - 1) == .stacked)
        #expect(TuneAttributes.arrangement(forColumnWidth: beside) == .beside)
        #expect(TuneAttributes.arrangement(forColumnWidth: PageStyle.attributesColumnMaxWidth) == .beside)
    }

    @Test func anAccessibilityTextSizeStacksEveryRow() {
        #expect(TuneAttributes.arrangement(.beside, accessibilitySize: true) == .stacked)
        #expect(TuneAttributes.arrangement(.beside, accessibilitySize: false) == .beside)
        #expect(TuneAttributes.arrangement(.stacked, accessibilitySize: false) == .stacked)
    }

    @Test func theColumnGrowsOnceTheContentHasItsReadableWidth() {
        let content = PageStyle.pageMaxWidth + 2 * PageStyle.pageMargin + PageStyle.attributesColumnGap
        let narrowest = PageStyle.attributesColumnWidth
        let widest = PageStyle.attributesColumnMaxWidth
        #expect(TuneAttributes.columnWidth(forDetailWidth: 600) == narrowest)
        #expect(TuneAttributes.columnWidth(forDetailWidth: content + narrowest) == narrowest)
        #expect(TuneAttributes.columnWidth(forDetailWidth: content + narrowest + 20) == narrowest + 20)
        #expect(TuneAttributes.columnWidth(forDetailWidth: content + widest) == widest)
        #expect(TuneAttributes.columnWidth(forDetailWidth: 3000) == widest)
    }

    @Test func theColumnSwitchesBetweenItsNarrowestAndWidest() {
        #expect(PageStyle.attributesColumnWidth < PageStyle.attributesColumnBesideWidth)
        #expect(PageStyle.attributesColumnBesideWidth <= PageStyle.attributesColumnMaxWidth)
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
                ("Mac 900", macDetail(900), AttributesLayout.card),
                ("Mac 1400", macDetail(1400), .column),
            ] as [(String, CGFloat, AttributesLayout)])
        func theMacLayoutFollowsTheWindow(_ place: String, _ width: CGFloat, _ expected: AttributesLayout) {
            #expect(TuneAttributes.layout(forDetailWidth: width) == expected, "\(place) at \(width)")
        }
    #endif

    /// The layout follows the detail column's width, never the device: each case is a window
    /// width turned into the column the shell gives the page.
    @Test(
        arguments: [
            // iPad Pro 13-inch landscape and portrait, iPad Pro 11-inch landscape and portrait.
            ("iPad 13 landscape", padDetail(1376), AttributesLayout.column),
            ("iPad 13 portrait", padDetail(1032), .card),
            ("iPad 11 landscape", padDetail(1210), .column),
            ("iPad 11 portrait", padDetail(834), .card),
            // Slide Over runs the phone shell at full width; Stage Manager resizes a split window.
            ("Slide Over", 320, .card),
            ("Stage Manager narrow", padDetail(1000), .card),
            ("Stage Manager wide", padDetail(1200), .column),
            // The iPhone Duo's inner display (669 by 951) splits evenly; closed, it is a phone.
            ("Duo open portrait", padDetail(669), .card),
            ("Duo open landscape", padDetail(951), .card),
            ("Duo closed", 466, .card),
        ] as [(String, CGFloat, AttributesLayout)])
    func theLayoutFollowsTheDetailColumn(_ place: String, _ width: CGFloat, _ expected: AttributesLayout) {
        #expect(TuneAttributes.layout(forDetailWidth: width) == expected, "\(place) at \(width)")
    }

    // MARK: Pinning

    @Test func theColumnStaysPutUntilItsTopReachesThePin() {
        #expect(TuneAttributes.pinOffset(top: 50, minY: 120, containerHeight: 1000, attributesHeight: 400) == 0)
        #expect(TuneAttributes.pinOffset(top: 50, minY: 50, containerHeight: 1000, attributesHeight: 400) == 0)
    }

    @Test func thePinnedColumnFollowsTheScroll() {
        #expect(TuneAttributes.pinOffset(top: 50, minY: -100, containerHeight: 1000, attributesHeight: 400) == 150)
    }

    @Test func thePinnedColumnStopsAtTheColumnsEnd() {
        #expect(TuneAttributes.pinOffset(top: 50, minY: -900, containerHeight: 1000, attributesHeight: 400) == 600)
        #expect(TuneAttributes.pinOffset(top: 50, minY: -900, containerHeight: 300, attributesHeight: 400) == 0)
    }

    // MARK: Open editor

    private typealias Key = AttributesOpenState.Key

    @Test func onlyTheOpenedRowShowsItsEditor() {
        var state = AttributesOpenState()
        let status = Key(tuneID: "a", layout: .column, id: .status)
        state.set(status, shown: true)
        #expect(state.isPresented(status))
        #expect(!state.isPresented(Key(tuneID: "a", layout: .column, id: .key)))
        #expect(!state.isPresented(Key(tuneID: "b", layout: .column, id: .status)))
        #expect(!state.isPresented(Key(tuneID: "a", layout: .card, id: .status)))
    }

    @Test func anotherRowClosingLeavesTheOpenOneAlone() {
        var state = AttributesOpenState()
        let status = Key(tuneID: "a", layout: .column, id: .status)
        state.set(status, shown: true)
        state.set(Key(tuneID: "a", layout: .column, id: .key), shown: false)
        #expect(state.isPresented(status))
        state.set(status, shown: false)
        #expect(!state.isPresented(status))
    }

    @Test func anotherTuneOrLayoutClosesTheEditor() {
        let status = Key(tuneID: "a", layout: .column, id: .status)
        var swapped = AttributesOpenState()
        swapped.set(status, shown: true)
        swapped.keep(tuneID: "b", layout: .column)
        swapped.keep(tuneID: "a", layout: .column)
        #expect(!swapped.isPresented(status), "a return to the tune never reopens it")

        var flipped = AttributesOpenState()
        flipped.set(status, shown: true)
        flipped.keep(tuneID: "a", layout: .card)
        flipped.keep(tuneID: "a", layout: .column)
        #expect(!flipped.isPresented(status))

        var same = AttributesOpenState()
        same.set(status, shown: true)
        same.keep(tuneID: "a", layout: .column)
        #expect(same.isPresented(status))
    }

    // MARK: Rows

    @Test func theColumnGroupsTheAttributesUnderDetailsAboutAndLearnedInOrder() {
        let rows = AttributeRows.rows(detail())
        let column = TuneAttributes.column(rows)
        #expect(
            column.details.map(\.id) == [
                .status, .key, .tuning("violin"), .tuneType, .timeSignature, .partStructure,
            ])
        #expect(column.about.map(\.id) == [.genre, .composer, .alternateTitles])
        #expect(column.learned.map(\.id) == [.learnedFrom, .learnedOn])
    }

    @Test func theColumnGroupHeadingsMatchTheWebClient() {
        #expect(AttributeCopy.detailsGroup == "Details")
        #expect(AttributeCopy.aboutGroup == "About")
        #expect(AttributeCopy.learnedGroup == "Learned")
        #expect(AttributeCopy.listsGroup == "Lists")
    }

    @Test func anUnsetValueReadsAdd() {
        let rows = AttributeRows.rows(detail(learnedFrom: "Kevin Burke"))
        let type = rows.first { $0.id == .tuneType }!
        let from = rows.first { $0.id == .learnedFrom }!
        #expect(TuneAttributes.value(type) == AttributeCopy.addValue)
        #expect(TuneAttributes.value(from) == "Kevin Burke")
    }

    @Test func eachRowIsNamedForItsLabelAndValue() {
        let rows = AttributeRows.rows(detail())
        let status = rows.first { $0.id == .status }!
        let type = rows.first { $0.id == .tuneType }!
        #expect(TuneAttributes.accessibilityLabel(status) == "Status, Learning")
        #expect(TuneAttributes.accessibilityLabel(type) == "Type, Add")
    }

    @Test func theCardShowsTheMainAttributesUntilMoreDetailsOpens() {
        let tune = Tune(createdAt: noon, title: "T", tuneType: "reel", partStructure: "AABB")
        let rows = AttributeRows.rows(detail(tune))
        let closed = TuneAttributes.card(rows, expanded: false)
        #expect(closed.shown.map(\.id) == [.status, .key, .tuning("violin"), .tuneType])
        #expect(closed.shown.last?.text == "reel · AABB")
        #expect(closed.more.isEmpty)
        #expect(closed.learned.isEmpty)

        let open = TuneAttributes.card(rows, expanded: true)
        #expect(open.shown == closed.shown)
        #expect(open.more.map(\.id) == [.timeSignature, .partStructure, .genre, .composer, .alternateTitles])
        #expect(open.learned.map(\.id) == [.learnedFrom, .learnedOn])
    }

    @Test func moreDetailsSaysWhetherItIsOpen() {
        #expect(TuneAttributes.moreDetailsState(expanded: true) == DisclosureCopy.expanded)
        #expect(TuneAttributes.moreDetailsState(expanded: false) == DisclosureCopy.collapsed)
    }

    // MARK: Tune identity

    /// A swap of the detail column's tune must tear the rows down, so an open editor ends as
    /// `.unmounted` and saves to the tune it opened for, through that tune's own model. Neither
    /// shows without a window, so the source is read.
    @Test func theRowsBelongToTheTuneTheyWriteTo() throws {
        let text = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "Tune/TuneAttributes.swift")))
        #expect(text.contains(".id(model.tuneID)"), "Key the attributes to the model's tune")
        #expect(text.contains("write: model.write"), "Write through the tune's own model")
    }
}
