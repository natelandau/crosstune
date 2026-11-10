#if os(macOS)
    import AppKit
    import CrosstuneCommands
    import CrosstuneDesign
    import CrosstuneStore
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    struct MacSurfacePolishTests {
        /// The title a form types sits under the sheet's title, so it never outranks it.
        @Test func formTitleSitsUnderTheSheetTitle() {
            #expect(MacStyle.formTitleSize < MacStyle.sheetTitleSize)
        }

        /// A form's rows share one label column as wide as their widest label, within bounds, so
        /// fields and pop-ups start on one edge.
        @Test func formLabelColumnFitsItsWidestLabel() {
            let (low, high) = (MacForm.labelMinWidth, MacForm.labelMaxWidth)
            let between = ((low + high) / 2).rounded(.down) + 0.2
            #expect(MacForm.labelColumn([low / 2, low - 1]) == low)
            #expect(MacForm.labelColumn([low / 2, between]) == between.rounded(.up))
            #expect(MacForm.labelColumn([high * 2]) == high)
            #expect(MacForm.labelColumn([]) == low)
        }

        /// A tune already in the list says so to VoiceOver; on screen its check says it, so the
        /// key pills line up down the column.
        @Test func takenTuneSaysItIsInTheListAloud() throws {
            let text = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Lists/TunePickerSheet.swift")))
            #expect(SourceScan.macCompiled(text).contains("Text(TunePickerModel.inThisList)") == false)
        }

        /// A list's head is one height whether its play controls or the selection bar sit under
        /// its title, so entering selection never moves the rows, and it holds the controls'
        /// room until it reads what can play.
        @Test func listHeadKeepsItsHeightWhateverItHolds() {
            let offer = ListPlayAvailability(
                report: PlaylistReport(playable: ["a"], total: 2), canStart: true,
                onPlay: {}, onShuffle: {})
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

        /// Whether `view`, drawn `width` wide with nothing over it, paints anything in its last
        /// `trailing` points.
        private func drawsInTrailingEdge(_ view: some View, width: CGFloat, trailing: CGFloat) throws -> Bool {
            try trailingInk(view, width: width, trailing: trailing) != nil
        }

        /// The rows `view` paints in its last `trailing` points, and its height, drawn `width` wide.
        private func trailingInk(
            _ view: some View, width: CGFloat, trailing: CGFloat, sourceLocation: SourceLocation = #_sourceLocation
        ) throws
            -> (top: Int, bottom: Int, height: Int)?
        {
            let renderer = ImageRenderer(content: view.frame(width: width))
            renderer.scale = 1
            let image = try #require(renderer.cgImage, sourceLocation: sourceLocation)
            let (columns, rows) = (image.width, image.height)
            var pixels = [UInt8](repeating: 0, count: columns * rows * 4)
            let context = try #require(
                CGContext(
                    data: &pixels, width: columns, height: rows, bitsPerComponent: 8, bytesPerRow: columns * 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
                sourceLocation: sourceLocation)
            context.draw(image, in: CGRect(x: 0, y: 0, width: columns, height: rows))
            let start = columns - Int(trailing)
            let inked = (0..<rows).filter { row in
                (start..<columns).contains { pixels[(row * columns + $0) * 4 + 3] > 0 }
            }
            guard let top = inked.first, let bottom = inked.last else { return nil }
            return (top, bottom, rows)
        }

        /// A row with no glyph keeps its slot, so its text ends on the same edge as its neighbors'.
        @Test func mediaRowWithNoGlyphKeepsItsSlot() {
            func idealWidth(_ glyph: MediaGlyph) -> CGFloat {
                hostedSize(MediaRow(glyph: glyph, title: "Take 1", secondLine: .text("1:02"))).width
            }
            #expect(idealWidth(.none) == idealWidth(.play))
        }

        /// A media row holds two lines or more, so its glyph is the larger one and centers on
        /// the whole row, as on the web.
        @Test func mediaRowGlyphCentersOnTheRow() throws {
            let row = MediaRow(
                glyph: .play, title: "Take 1", secondLine: .text("1:02"), actionLabel: "Play", action: {})
            let ink = try #require(try trailingInk(row, width: 320, trailing: RowSlotMetrics.baseWidth))
            let drawn = ink.bottom - ink.top + 1
            #expect(drawn >= Int(PageStyle.mediaRowGlyphSize) - 2)
            let middle = Double(ink.top + ink.bottom + 1) / 2
            #expect(abs(middle - Double(ink.height) / 2) <= 1)
        }

        /// A list row's play shows at rest, as on iPhone, iPad, and the web.
        @Test func listRowPlayShowsWithNothingOverIt() throws {
            let sample = SampleCatalog.entries[0]
            let entry = bareListEntry(tune: sample.tune, userTune: sample.userTune)
            let item = sampleRecordingItem()
            let slot = RowSlotMetrics.baseWidth
            let play = ListRowPlayButton(entry: entry, action: .play(item), listID: "l1")
            #expect(try drawsInTrailingEdge(play, width: slot, trailing: slot))
            let empty = ListRowPlayButton(entry: entry, action: nil, listID: "l1")
            #expect(try drawsInTrailingEdge(empty, width: slot, trailing: slot) == false)
        }

        /// A list's tune row draws its key and play the same on every platform: the row keeps its
        /// key, and play sits after it outside any Mac-only branch.
        @Test func listRowDrawsPlayOnEveryPlatform() throws {
            let text = SourceScan.withoutComments(
                try SourceScan.text(at: SourceScan.url(of: "Lists/ListScreen.swift")))
            #expect(SourceScan.macCompiled(text).contains("ListRowPlayButton(entry: entry"))
            #expect(SourceScan.iOSCompiled(text).contains("ListRowPlayButton(entry: entry"))
            #expect(SourceScan.macOSRegions(of: text).contains("ListRowPlayButton(") == false)
            #expect(text.contains("onHover") == false)
        }

        /// A media row's play and download glyphs show at rest, as on iPhone, iPad, and the web.
        @Test(arguments: [MediaGlyph.play, .download])
        func mediaRowGlyphShowsWithNothingOverIt(glyph: MediaGlyph) throws {
            let slot = RowSlotMetrics.baseWidth
            let row = MediaRow(
                glyph: glyph, title: "Take 1", secondLine: .text("1:02"), actionLabel: "Play", action: {})
            #expect(try drawsInTrailingEdge(row, width: 320, trailing: slot))
            let bare = MediaRow(
                glyph: .none, title: "Take 1", secondLine: .text("1:02"), actionLabel: "Play", action: {})
            #expect(try drawsInTrailingEdge(bare, width: 320, trailing: slot) == false)
        }
    }
#endif
