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
        #expect(AttributesLayout.layout(forDetailWidth: threshold - 1) == .card)
        #expect(AttributesLayout.layout(forDetailWidth: threshold) == .column)
        #expect(AttributesLayout.layout(forDetailWidth: 0) == .card)
    }

    @Test func aWideColumnSetsEachValueBesideItsLabel() {
        let beside = PageStyle.attributesColumnBesideWidth
        #expect(AttributeRowArrangement.arrangement(forColumnWidth: PageStyle.attributesColumnWidth) == .stacked)
        #expect(AttributeRowArrangement.arrangement(forColumnWidth: beside - 1) == .stacked)
        #expect(AttributeRowArrangement.arrangement(forColumnWidth: beside) == .beside)
        #expect(AttributeRowArrangement.arrangement(forColumnWidth: PageStyle.attributesColumnMaxWidth) == .beside)
    }

    @Test func anAccessibilityTextSizeStacksEveryRow() {
        #expect(AttributeRowArrangement.arrangement(.beside, accessibilitySize: true) == .stacked)
        #expect(AttributeRowArrangement.arrangement(.beside, accessibilitySize: false) == .beside)
        #expect(AttributeRowArrangement.arrangement(.stacked, accessibilitySize: false) == .stacked)
    }

    @Test func theColumnGrowsOnceTheContentHasItsReadableWidth() {
        let content = PageStyle.pageMaxWidth + 2 * PageStyle.pageMargin + PageStyle.attributesColumnGap
        let narrowest = PageStyle.attributesColumnWidth
        let widest = PageStyle.attributesColumnMaxWidth
        #expect(AttributesLayout.columnWidth(forDetailWidth: 600) == narrowest)
        #expect(AttributesLayout.columnWidth(forDetailWidth: content + narrowest) == narrowest)
        #expect(AttributesLayout.columnWidth(forDetailWidth: content + narrowest + 20) == narrowest + 20)
        #expect(AttributesLayout.columnWidth(forDetailWidth: content + widest) == widest)
        #expect(AttributesLayout.columnWidth(forDetailWidth: 3000) == widest)
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
            #expect(AttributesLayout.layout(forDetailWidth: width) == expected, "\(place) at \(width)")
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
        #expect(AttributesLayout.layout(forDetailWidth: width) == expected, "\(place) at \(width)")
    }

    // MARK: Pinning

    @Test func theColumnStaysPutUntilItsTopReachesThePin() {
        #expect(PinsWhileScrolling.offset(top: 50, minY: 120, containerHeight: 1000, attributesHeight: 400) == 0)
        #expect(PinsWhileScrolling.offset(top: 50, minY: 50, containerHeight: 1000, attributesHeight: 400) == 0)
    }

    @Test func thePinnedColumnFollowsTheScroll() {
        #expect(PinsWhileScrolling.offset(top: 50, minY: -100, containerHeight: 1000, attributesHeight: 400) == 150)
    }

    @Test func thePinnedColumnStopsAtTheColumnsEnd() {
        #expect(PinsWhileScrolling.offset(top: 50, minY: -900, containerHeight: 1000, attributesHeight: 400) == 600)
        #expect(PinsWhileScrolling.offset(top: 50, minY: -900, containerHeight: 300, attributesHeight: 400) == 0)
    }

    // MARK: Open editor

    private typealias Key = AttributesOpenState.Key

    @Test func onlyTheOpenedRowShowsItsEditor() {
        var state = AttributesOpenState()
        let status = Key(owner: "a", layout: .column, id: AttributeID.status)
        state.set(status, shown: true)
        #expect(state.isPresented(status))
        #expect(!state.isPresented(Key(owner: "a", layout: .column, id: AttributeID.key)))
        #expect(!state.isPresented(Key(owner: "b", layout: .column, id: AttributeID.status)))
        #expect(!state.isPresented(Key(owner: "a", layout: .card, id: AttributeID.status)))
    }

    @Test func anotherRowClosingLeavesTheOpenOneAlone() {
        var state = AttributesOpenState()
        let status = Key(owner: "a", layout: .column, id: AttributeID.status)
        state.set(status, shown: true)
        state.set(Key(owner: "a", layout: .column, id: AttributeID.key), shown: false)
        #expect(state.isPresented(status))
        state.set(status, shown: false)
        #expect(!state.isPresented(status))
    }

    @Test func anotherTuneOrLayoutClosesTheEditor() {
        let status = Key(owner: "a", layout: .column, id: AttributeID.status)
        var swapped = AttributesOpenState()
        swapped.set(status, shown: true)
        swapped.keep(owner: "b", layout: .column)
        swapped.keep(owner: "a", layout: .column)
        #expect(!swapped.isPresented(status), "a return to the tune never reopens it")

        var flipped = AttributesOpenState()
        flipped.set(status, shown: true)
        flipped.keep(owner: "a", layout: .card)
        flipped.keep(owner: "a", layout: .column)
        #expect(!flipped.isPresented(status))

        var same = AttributesOpenState()
        same.set(status, shown: true)
        same.keep(owner: "a", layout: .column)
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

    @Test func theColumnRowsSitUnderTheirGroupsHeadings() {
        let rows = TuneAttributes.columnRows(AttributeRows.rows(detail()))
        let entries = AttributeColumnEntry.entries(groups: TuneAttributes.columnGroups, rows: rows)
        let headings = entries.compactMap { entry -> String? in
            if case .heading(let title, _) = entry { title } else { nil }
        }
        #expect(headings == [AttributeCopy.detailsGroup, AttributeCopy.aboutGroup, AttributeCopy.learnedGroup])
        #expect(rows.map(\.id) == AttributeRows.rows(detail()).map(\.id))
        #expect(rows.allSatisfy { !$0.isReadOnly })
    }

    @Test func anUnsetValueReadsAdd() {
        let rows = TuneAttributes.columnRows(AttributeRows.rows(detail(learnedFrom: "Kevin Burke")))
        let type = rows.first { $0.id == .tuneType }!
        let from = rows.first { $0.id == .learnedFrom }!
        #expect(type.value(emptyText: AttributeCopy.addValue) == AttributeCopy.addValue)
        #expect(from.value(emptyText: AttributeCopy.addValue) == "Kevin Burke")
    }

    @Test func eachRowIsNamedForItsLabelAndValue() {
        let rows = TuneAttributes.columnRows(AttributeRows.rows(detail()))
        let status = rows.first { $0.id == .status }!
        let type = rows.first { $0.id == .tuneType }!
        #expect(status.accessibilityLabel(emptyText: AttributeCopy.addValue) == "Status, Learning")
        #expect(type.accessibilityLabel(emptyText: AttributeCopy.addValue) == "Type, Add")
    }

    @Test func theCardShowsTheMainAttributesUntilMoreDetailsOpens() {
        let tune = Tune(createdAt: noon, title: "T", tuneType: "reel", partStructure: "AABB")
        let card = TuneAttributes.cardRows(AttributeRows.rows(detail(tune)))
        func sections(expanded: Bool) -> [AttributeCardSection<AttributeID>] {
            AttributeCardSection.sections(
                groups: TuneAttributes.cardGroups, rows: card.rows, beforeMoreDetails: card.beforeMoreDetails,
                expanded: expanded)
        }
        let closed = sections(expanded: false)
        #expect(closed.count == 1)
        #expect(closed[0].heading == nil)
        #expect(closed[0].hasMoreDetails)
        #expect(closed[0].rows.map(\.id) == [.status, .key, .tuning("violin"), .tuneType])
        #expect(closed[0].rows.last?.text == "reel · AABB")
        #expect(closed[0].more.isEmpty)

        let open = sections(expanded: true)
        #expect(open.count == 2)
        #expect(open[0].rows == closed[0].rows)
        #expect(open[0].more.map(\.id) == [.timeSignature, .partStructure, .genre, .composer, .alternateTitles])
        #expect(open[1].heading == AttributeCopy.learnedGroup)
        #expect(open[1].rows.map(\.id) == [.learnedFrom, .learnedOn])
    }

    @Test func moreDetailsSaysWhetherItIsOpen() {
        #expect(MoreDetailsText.state(expanded: true) == DisclosureCopy.expanded)
        #expect(MoreDetailsText.state(expanded: false) == DisclosureCopy.collapsed)
    }

    /// The column draws every group's heading, so no tune may leave a group empty.
    @Test func everyColumnGroupHasARowForEveryTune() {
        let rows = TuneAttributes.columnRows(AttributeRows.rows(detail()))
        for group in TuneAttributes.columnGroups {
            #expect(rows.contains { $0.group == group }, "\(group)")
        }
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
