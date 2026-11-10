import CoreGraphics
import CrosstuneDesign
import Testing

@testable import CrosstuneUI

struct PadStyleTests {
    @Test func contentColumnTakesItsShareAboveItsFloor() {
        let floor = PadStyle.contentColumnMinWidth
        let wide: CGFloat = floor / PadStyle.contentColumnShare * 2
        let share: CGFloat = wide * PadStyle.contentColumnShare
        #expect(PadStyle.contentColumnWidth(in: wide) == share)
        #expect(PadStyle.contentColumnWidth(in: floor) == floor)
    }

    @Test func bottomBarMeetsTheTouchTarget() {
        #expect(PadStyle.bottomBarHeight >= minimumTapTarget)
    }
}
