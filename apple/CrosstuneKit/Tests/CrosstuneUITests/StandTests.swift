import CoreGraphics
import CrosstuneStore
import Testing

@testable import CrosstuneUI

@Suite struct StandTests {
    private static let landscape = CGSize(width: 1194, height: 834)
    private static let portrait = CGSize(width: 834, height: 1194)

    private static let scan = Scan(
        record: ScanRecord(id: "scan1", tuneID: "tune1", width: 600, height: 800, state: ScanRecord.ready), file: nil)

    @Test func landscapeSitsSideBySide() {
        #expect(
            StandArrangement.arrange(
                size: Self.landscape, hasReading: true, readingHidden: false, isAccessibilitySize: false)
                == .sideBySide)
    }

    @Test func portraitStacks() {
        #expect(
            StandArrangement.arrange(
                size: Self.portrait, hasReading: true, readingHidden: false, isAccessibilitySize: false) == .stacked)
    }

    @Test func nothingToReadIsPracticeOnly() {
        for size in [Self.landscape, Self.portrait] {
            #expect(
                StandArrangement.arrange(
                    size: size, hasReading: false, readingHidden: false, isAccessibilitySize: false)
                    == .practiceOnly)
        }
    }

    @Test func hiddenReadingIsPracticeOnly() {
        for size in [Self.landscape, Self.portrait] {
            #expect(
                StandArrangement.arrange(size: size, hasReading: true, readingHidden: true, isAccessibilitySize: true)
                    == .practiceOnly)
        }
    }

    @Test func panesSettleOnceReadAndStackedPracticeHasMeasured() {
        let settled = { (arrangement: StandArrangement, read: Bool, measures: Bool, minimum: Bool) in
            StandArrangement.isSettled(
                arrangement, hasRead: read, practiceMeasures: measures, hasPracticeMinimum: minimum)
        }
        for arrangement in [StandArrangement.practiceOnly, .sideBySide, .stacked] {
            #expect(!settled(arrangement, false, true, true))
        }
        #expect(settled(.sideBySide, true, true, false))
        #expect(settled(.practiceOnly, true, true, false))
        #expect(!settled(.stacked, true, true, false))
        #expect(settled(.stacked, true, true, true))
        #expect(settled(.stacked, true, false, false))
    }

    @Test func accessibilitySizesStackInLandscape() {
        #expect(
            StandArrangement.arrange(
                size: Self.landscape, hasReading: true, readingHidden: false, isAccessibilitySize: true)
                == .stacked)
    }

    @Test func portraitGivesReadingTheLargerShare() {
        #expect(StandArrangement.stackedPracticeShare(Self.portrait) < 0.5)
    }

    @Test func landscapeStackedForLargeTextKeepsPracticeTheLargerShare() {
        #expect(StandArrangement.stackedPracticeShare(Self.landscape) > 0.5)
    }

    @Test func bothKindsShowTheControlScansFirst() {
        let both = StandReading(tuneID: "tune1", scans: [Self.scan], lyrics: "Words")
        let scansOnly = StandReading(tuneID: "tune1", scans: [Self.scan], lyrics: nil)
        let lyricsOnly = StandReading(tuneID: "tune1", scans: [], lyrics: "Words")
        #expect(ReadingChoice.segments(both) == [.scans, .lyrics])
        #expect(ReadingChoice.segments(scansOnly).isEmpty)
        #expect(ReadingChoice.segments(lyricsOnly).isEmpty)
    }
}
