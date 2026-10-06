import Testing

@testable import CrosstuneUI

@Suite struct PadStyleTests {
    @Test func practiceAndReadingEachKeepAPane() {
        #expect((0.5...0.7).contains(PadStyle.standPracticeShare))
        #expect(PadStyle.standReadingShare > 0.5)
        #expect(PadStyle.standReadingMinShare < 1 - PadStyle.standPracticeShare)
    }

    @Test func contentColumnHoldsBetweenItsNarrowestAndWidest() {
        #expect(PadStyle.contentColumnWidth(in: 744) == PadStyle.contentColumnMinWidth)
        #expect(PadStyle.contentColumnWidth(in: 1376) == PadStyle.contentColumnMaxWidth)
        let between = (PadStyle.contentColumnMinWidth + PadStyle.contentColumnMaxWidth) / 2
        #expect(abs(PadStyle.contentColumnWidth(in: between / PadStyle.contentColumnShare) - between) < 0.001)
    }

    @Test func footMeetsTheTouchTarget() {
        #expect(PadStyle.footHeight >= minimumTapTarget)
    }

    // Lyrics draw in the dark scheme's primary, white, on either ground.
    @Test func lyricsReadOnTheGround() {
        for ground in [PhoneStyle.practiceGroundLight, PhoneStyle.practiceGroundDark] {
            #expect(contrastRatio("#FFFFFF", ground) >= 7, "lyrics on \(ground)")
        }
    }
}
