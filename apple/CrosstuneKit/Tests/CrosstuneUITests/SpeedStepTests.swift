import SwiftUI
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct SpeedStepTests {
    @Test(arguments: [
        (70, -5, 65),
        (70, 5, 75),
        (72, -5, 70),
        (72, 5, 75),
        (73, -5, 70),
        (73, 5, 75),
        (72, -10, 65),
        (52, -5, 50),
        (148, 5, 150),
        (50, -5, 50),
        (150, 5, 150),
    ])
    func neverSkipsAGridStep(percent: Int, delta: Int, expected: Int) {
        #expect(SpeedPanel.stepped(percent, by: delta) == expected)
    }
}

#if os(macOS)
    import AppKit

    @MainActor
    @Suite struct SpeedPresetRowTests {
        private func height(at size: DynamicTypeSize, width: CGFloat) -> CGFloat {
            let host = NSHostingController(
                rootView: SpeedPresetRow(value: 100, onChange: { _ in }).environment(\.dynamicTypeSize, size))
            return host.sizeThatFits(in: CGSize(width: width, height: 10_000)).height
        }

        @Test func staysOneLineAtTheDefaultSize() {
            #expect(height(at: .large, width: 358) <= PracticeLayout.target + 24)
        }

        @Test func wrapsAsAWholeAtAccessibilitySizes() {
            let line = height(at: .large, width: 358)
            #expect(height(at: .accessibility5, width: 358) > line * 2)
        }
    }
#endif
