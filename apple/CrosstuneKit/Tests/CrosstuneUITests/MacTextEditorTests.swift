#if os(macOS)
    import AppKit
    import CrosstuneDesign
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    @Suite struct MacTextEditorTests {
        private static func views<T: NSView>(_ type: T.Type, in view: NSView) -> [T] {
            (view as? T).map { [$0] } ?? [] + view.subviews.flatMap { views(type, in: $0) }
        }

        /// Whether the text area's editor carries a scroller once laid out in a window. A legacy
        /// scroller (a mouse attached, or "always show scroll bars") shows whenever it is there.
        private func showsScroller(text: String, minLines: Int, maxLines: Int?) throws -> Bool {
            let area = MacTextArea(
                "Notes", text: .constant(text), placeholder: "", minLines: minLines, maxLines: maxLines
            )
            .frame(width: 300)
            .fixedSize(horizontal: false, vertical: true)
            let host = NSHostingView(rootView: area)
            let window = hiddenWindow(size: CGSize(width: 400, height: 400), styleMask: [], appearance: .aqua)
            defer { window.close() }
            window.contentView = host
            for _ in 0..<5 {
                host.frame.size = host.fittingSize
                host.layoutSubtreeIfNeeded()
                RunLoop.main.run(until: .now)
            }
            let scroll = try #require(Self.views(NSScrollView.self, in: host).first)
            return scroll.hasVerticalScroller && !scroll.autohidesScrollers
        }

        /// An editor holding no more lines than it shows never draws a scroller.
        @Test(arguments: [1, 3])
        func editorWithRoomShowsNoScroller(minLines: Int) throws {
            #expect(try !showsScroller(text: "", minLines: minLines, maxLines: 8))
            #expect(try !showsScroller(text: "One line", minLines: minLines, maxLines: 8))
            let full = Array(repeating: "Line", count: minLines).joined(separator: "\n")
            #expect(try !showsScroller(text: full, minLines: minLines, maxLines: 8))
        }

        @Test func editorPastItsLastLineShowsItsScroller() throws {
            let long = Array(repeating: "Line", count: 6).joined(separator: "\n")
            #expect(try showsScroller(text: long, minLines: 1, maxLines: 3))
        }

        @Test func overflowCountsWrappedAndTrailingLines() {
            let lineHeight = MacTextEditorBackground.lineHeight
            #expect(!MacTextArea.overflows("", width: 200, height: lineHeight))
            #expect(!MacTextArea.overflows("One", width: 200, height: lineHeight))
            #expect(MacTextArea.overflows("One\nTwo", width: 200, height: lineHeight))
            #expect(MacTextArea.overflows("One\n", width: 200, height: lineHeight))
            let wraps = String(repeating: "word ", count: 40)
            #expect(MacTextArea.overflows(wraps, width: 200, height: 3 * lineHeight))
            #expect(!MacTextArea.overflows("One\nTwo\nThree", width: 200, height: 3 * lineHeight))
        }
    }
#endif
