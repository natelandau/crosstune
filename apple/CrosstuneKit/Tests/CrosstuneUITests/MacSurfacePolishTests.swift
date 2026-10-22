#if os(macOS)
    import AppKit
    import CrosstuneCommands
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
                try SourceScan.text(at: SourceScan.sources.appending(path: "Lists/TunePickerSheet.swift")))
            #expect(!SourceScan.macCompiled(text).contains("Text(TunePickerModel.inThisList)"))
        }

        /// An empty section on the tune page reads as one quiet line, never a centered block
        /// with a large glyph.
        @Test func pageEmptyStateIsOneLineOnTheMac() throws {
            let text = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.sources.appending(path: "Components/PageEmptyState.swift")))
            let mac = SourceScan.macCompiled(text)
            #expect(!mac.contains(".system(size: 28)"))
            #expect(!mac.contains("multilineTextAlignment(.center)"))
        }

        /// A list's head is one height whether the play line, nothing, or the selection bar
        /// sits under its title, so entering selection never moves the rows.
        @Test func listHeadKeepsItsHeightWhateverItHolds() {
            let offer = ListPlayOffer(
                report: PlaylistReport(playable: ["a"], skipped: [.nothing: ["b"]], total: 2), canStart: true,
                onPlay: {}, onShuffle: {}, onWhatPlays: {})
            let bar = AnyView(
                MacSelectionBar(
                    count: 1, allSelected: false, canSelectAll: true, onSelectAll: {}, actions: [], canAddToList: true,
                    isPending: false, onAction: { _ in }, onDone: {}))
            func height(play: ListPlayOffer?, selecting: Bool) -> CGFloat {
                let head = MacListTitle(name: "Tuesday session", play: play, isSelecting: selecting)
                    .environment(\.selectionBar, bar)
                    .frame(width: 420)
                return NSHostingView(rootView: head).fittingSize.height
            }
            let playing = height(play: offer, selecting: false)
            #expect(height(play: nil, selecting: false) == playing)
            #expect(height(play: nil, selecting: true) == playing)
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
