import Testing

@testable import CrosstuneUI

@Suite struct PadStyleTests {
    @Test func practiceAndReadingEachKeepAPane() {
        #expect((0.5...0.7).contains(PadStyle.padPracticeShare))
        #expect(PadStyle.readingPaneShare > 0.5)
        #expect(PadStyle.readingPaneMinShare < 1 - PadStyle.padPracticeShare)
    }

    @Test func contentColumnTakesHalfAboveItsFloor() {
        #expect(PadStyle.contentColumnWidth(in: 1376) == 688)
        #expect(PadStyle.contentColumnWidth(in: 900) == 450)
        #expect(PadStyle.contentColumnWidth(in: 500) == PadStyle.contentColumnMinWidth)
    }

    @Test func bottomBarMeetsTheTouchTarget() {
        #expect(PadStyle.bottomBarHeight >= minimumTapTarget)
    }

    // Lyrics draw in the dark scheme's primary, white, on either ground.
    @Test func lyricsReadOnTheGround() {
        for ground in [PhoneStyle.practiceGroundLight, PhoneStyle.practiceGroundDark] {
            #expect(contrastRatio("#FFFFFF", ground) >= 7, "lyrics on \(ground)")
        }
    }
}
