#if os(macOS)
    import AppKit
    import CrosstuneCommands
    import CrosstuneDesign
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    @Suite struct MacSurfacePolishTests {
        /// The title a form types sits under the sheet's title, so it never outranks it.
        @Test func formTitleSitsUnderTheSheetTitle() {
            #expect(MacStyle.formTitleSize < MacStyle.sheetTitleSize)
            #expect(MacStyle.formTitleSize >= 17)
        }

        /// A form's rows share one label column as wide as their widest label, within bounds, so
        /// fields and pop-ups start on one edge.
        @Test func formLabelColumnFitsItsWidestLabel() {
            #expect(MacForm.labelColumn([40, 90]) == MacForm.labelMinWidth)
            #expect(MacForm.labelColumn([60, 131.2]) == 132)
            #expect(MacForm.labelColumn([400]) == MacForm.labelMaxWidth)
            #expect(MacForm.labelColumn([]) == MacForm.labelMinWidth)
        }

        /// A tune already in the list says so to VoiceOver; on screen its check says it, so the
        /// key pills line up down the column.
        @Test func takenTuneSaysItIsInTheListAloud() throws {
            let text = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Lists/TunePickerSheet.swift")))
            #expect(!SourceScan.macCompiled(text).contains("Text(TunePickerModel.inThisList)"))
        }

        /// A list's head is one height whether its play controls or the selection bar sit under
        /// its title, so entering selection never moves the rows, and it holds the controls'
        /// room until it reads what can play.
        @Test func listHeadKeepsItsHeightWhateverItHolds() {
            let offer = ListPlayAvailability(
                report: PlaylistReport(playable: ["a"], skipped: [.nothing: ["b"]], total: 2), canStart: true,
                onPlay: {}, onShuffle: {}, onWhatPlays: {})
            let bar = AnyView(
                MacSelectionBar(
                    count: 1, allSelected: false, canSelectAll: true, onSelectAll: {}, actions: [], canAddToList: true,
                    isPending: false, onAction: { _ in }, onDone: {}))
            func height(play: ListPlayAvailability?, selecting: Bool, waits: Bool = false) -> CGFloat {
                let head = MacListTitle(
                    name: "Tuesday session", play: play, isSelecting: selecting, waitsForPlay: waits
                )
                .environment(\.selectionBar, bar)
                .frame(width: 420)
                return NSHostingView(rootView: head).fittingSize.height
            }
            #expect(height(play: offer, selecting: true) == height(play: offer, selecting: false))
            #expect(height(play: nil, selecting: true) == height(play: nil, selecting: false))
            #expect(height(play: nil, selecting: false, waits: true) == height(play: offer, selecting: false))
        }

        /// A page's media row with no glyph keeps its own height when its column offers more,
        /// as a tune's content does beside a taller attributes column.
        @Test func glyphlessPageRowKeepsItsHeight() throws {
            let url = try #require(URL(string: "https://example.com/tune"))
            let row = MediaRow(glyph: .none, title: "Bibb County Hoedown", secondLine: .link("Open", url, name: "Open"))
                .environment(\.hangsMediaGlyph, true)
            let host = NSHostingController(rootView: row)
            let fitting = host.sizeThatFits(in: CGSize(width: 420, height: CGFloat.infinity)).height
            #expect(host.sizeThatFits(in: CGSize(width: 420, height: 1000)).height == fitting)
        }

        /// A taken row in the tune picker reads everything an open row does, then that it is in
        /// the list.
        @Test func takenRowReadsTheWholeRow() {
            let sample = SampleCatalog.entries[0]
            let entry = CatalogEntry(tune: sample.tune, userTune: sample.userTune)
            let row = TuneRowText(tune: entry.tune, userTune: entry.userTune, instruments: SampleCatalog.instruments)
                .accessibilityLabel(position: nil)
            #expect(
                TunePickerSheet.takenLabel(entry, instruments: SampleCatalog.instruments)
                    == "\(row), \(TunePickerModel.inThisList)")
        }
    }
#endif
