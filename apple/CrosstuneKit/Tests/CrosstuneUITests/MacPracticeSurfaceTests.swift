#if os(macOS)
    import CrosstuneDesign
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    /// The Mac's practice view, recordings, record sheet, media sheets, and dock.
    @Suite struct MacPracticeSurfaceTests {
        private static func macSource(_ path: String) throws -> String {
            SourceScan.macCompiled(
                SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: path))))
        }

        // MARK: Practice

        /// A ruler label that would run past either end of the waveform is left off; its tick stays.
        @Test func rulerDropsALabelThatPassesAnEdge() {
            #expect(PracticeWaveform.rulerLabelFits(atX: 100, labelWidth: 30, width: 400))
            #expect(!PracticeWaveform.rulerLabelFits(atX: 10, labelWidth: 30, width: 400))
            #expect(!PracticeWaveform.rulerLabelFits(atX: 390, labelWidth: 30, width: 400))
            #expect(PracticeWaveform.rulerLabelFits(atX: 15, labelWidth: 30, width: 400))
            #expect(PracticeWaveform.rulerLabelFits(atX: 385, labelWidth: 30, width: 400))
        }

        /// The loop switcher rides in the stage beside the readout, so no empty row holds the
        /// mode picker away from the transport.
        @Test func loopSwitcherSitsInTheStage() throws {
            #expect(!(try Self.macSource("RecordingScreen/Practice/PracticeControls.swift")).contains("LoopSwitcher("))
            let screen = SourceScan.macOSRegions(
                of: SourceScan.withoutComments(
                    try SourceScan.text(at: SourceScan.url(of: "RecordingScreen/RecordingScreen.swift"))
                ))
            #expect(screen.contains("LoopSwitcher("))
        }

        /// Why New loop is off shows as a caption; with nothing in the way the empty hint shows
        /// until there is a loop.
        @Test func loopsCaptionSaysWhyNewLoopIsOff() {
            #expect(LoopsPanel.macCaption(reason: PracticeText.noRoom, hasLoops: true) == PracticeText.noRoom)
            #expect(LoopsPanel.macCaption(reason: PracticeText.noRoom, hasLoops: false) == PracticeText.noRoom)
            #expect(LoopsPanel.macCaption(reason: nil, hasLoops: false) == PracticeText.loopsEmptyHint)
            #expect(LoopsPanel.macCaption(reason: nil, hasLoops: true) == nil)
        }

        // MARK: Record sheet

        /// Before the first recording Continue is the footer's primary and Return presses it; once
        /// recording, the footer has no primary and Stop takes Return.
        @MainActor @Test func recordSheetContinueIsThePrimary() throws {
            let asking = try #require(RecordSheet.macPrimary(asksLocation: true, isContinuing: false) {})
            #expect(asking.title == RecordSheetModel.continueToLocation)
            #expect(asking.answersReturn)
            #expect(asking.isEnabled)
            #expect(RecordSheet.macPrimary(asksLocation: true, isContinuing: true) {}?.isEnabled == false)
            #expect(RecordSheet.macPrimary(asksLocation: false, isContinuing: false) {} == nil)
        }

        // MARK: Sheets

        /// In light the scan background is the field gray, so a white page contrasts with it.
        @Test func scanBackgroundSetsThePageApart() {
            #expect(ScanViewer.scanBackgroundHex(.light) == Palette.hex(.field, .light))
            #expect(contrastRatio("#FFFFFF", ScanViewer.scanBackgroundHex(.light)) > 1.2)
        }

        /// The services and a service's results share one height, so going back from results
        /// or results arriving never leaves the sheet the wrong size.
        @Test func findRecordingsKeepsOneHeight() {
            let size = FindRecordingsSheet.macSize
            #expect(!size.isFitted)
            #expect(size.idealHeight == size.minHeight)
        }

        /// Under the catalog's title one block holds the selection bar, the filter row, or empty
        /// room of the same height, so entering selection never moves the rows.
        @Test func catalogHeadKeepsItsBlock() {
            for showsFilterRow in [false, true] {
                #expect(
                    CatalogScreen.macHeadBlock(isSelecting: true, showsFilterRow: showsFilterRow, hasTunes: true)
                        == .selectionBar)
            }
            #expect(CatalogScreen.macHeadBlock(isSelecting: false, showsFilterRow: true, hasTunes: true) == .filterRow)
            #expect(CatalogScreen.macHeadBlock(isSelecting: false, showsFilterRow: false, hasTunes: true) == .reserved)
            #expect(CatalogScreen.macHeadBlock(isSelecting: false, showsFilterRow: false, hasTunes: false) == nil)
        }

        /// A filter row wrapped to two lines hands its height to the selection bar, so entering
        /// selection still never moves the rows; with no filter row the bar keeps the block's.
        @Test func selectionBarTakesTheWrappedFilterRowsHeight() {
            let bar = MacStyle.columnBarHeight
            #expect(CatalogScreen.macSelectionBarHeight(showsFilterRow: true, filterRowHeight: bar * 2) == bar * 2)
            #expect(CatalogScreen.macSelectionBarHeight(showsFilterRow: true, filterRowHeight: nil) == bar)
            #expect(CatalogScreen.macSelectionBarHeight(showsFilterRow: true, filterRowHeight: bar - 4) == bar)
            #expect(CatalogScreen.macSelectionBarHeight(showsFilterRow: false, filterRowHeight: bar * 2) == bar)
        }

        /// A single-pick row's + shows only under the pointer or focus; an action row keeps it.
        @Test func addToTuneHidesThePlusAtRest() {
            #expect(!MacPickGlyph.shows(.addOnHighlight, highlighted: false))
            #expect(MacPickGlyph.shows(.addOnHighlight, highlighted: true))
            #expect(MacPickGlyph.shows(.add, highlighted: false))
        }

        // MARK: Recordings and dock

        /// Every dock glyph control is the Mac icon button; with an embed playing, a now-playing
        /// glyph shows where play would be.
        @Test func dockControlsAreIconButtons() throws {
            let text = try Self.macSource("Mac/PlayerDock.swift")
            #expect(!text.contains("DockGlyph"))
            #expect(text.contains(".mac(.icon"))
            #expect(text.contains("Image(systemName: Self.nowPlayingSymbol)"))
            #expect(PlayerDockBar.nowPlayingSymbol == "waveform")
        }
    }
#endif
