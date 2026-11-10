import CrosstuneDesign
import Testing

@testable import CrosstuneUI

struct PadStyleTests {
    @Test func contentColumnTakesHalfAboveItsFloor() {
        #expect(PadStyle.contentColumnWidth(in: 1376) == 688)
        #expect(PadStyle.contentColumnWidth(in: 900) == 450)
        #expect(PadStyle.contentColumnWidth(in: 500) == PadStyle.contentColumnMinWidth)
    }

    @Test func bottomBarMeetsTheTouchTarget() {
        #expect(PadStyle.bottomBarHeight >= minimumTapTarget)
    }
}
