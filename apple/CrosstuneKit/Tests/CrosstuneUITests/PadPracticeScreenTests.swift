import CoreGraphics
import CrosstuneStore
import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct PadPracticeScreenTests {
    private static let landscape = CGSize(width: 1194, height: 834)
    private static let portrait = CGSize(width: 834, height: 1194)

    private static let scan = Scan(
        record: ScanRecord(id: "scan1", tuneID: "tune1", width: 600, height: 800, state: ScanRecord.ready), file: nil)

    @Test func landscapeSitsSideBySide() {
        #expect(
            PadPracticeLayout.arrange(
                size: Self.landscape, hasReading: true, readingHidden: false, isAccessibilitySize: false)
                == .sideBySide)
    }

    @Test func portraitStacks() {
        #expect(
            PadPracticeLayout.arrange(
                size: Self.portrait, hasReading: true, readingHidden: false, isAccessibilitySize: false) == .stacked)
    }

    @Test func nothingToReadIsPracticeOnly() {
        for size in [Self.landscape, Self.portrait] {
            #expect(
                PadPracticeLayout.arrange(
                    size: size, hasReading: false, readingHidden: false, isAccessibilitySize: false)
                    == .practiceOnly)
        }
    }

    @Test func hiddenReadingIsPracticeOnly() {
        for size in [Self.landscape, Self.portrait] {
            #expect(
                PadPracticeLayout.arrange(size: size, hasReading: true, readingHidden: true, isAccessibilitySize: true)
                    == .practiceOnly)
        }
    }

    @Test func panesSettleOnceReadAndStackedPracticeHasMeasured() {
        let settled = { (arrangement: PadPracticeLayout, read: Bool, measures: Bool, minimum: Bool) in
            PadPracticeLayout.isSettled(
                arrangement, hasRead: read, practiceMeasures: measures, hasPracticeMinimum: minimum)
        }
        for arrangement in [PadPracticeLayout.practiceOnly, .sideBySide, .stacked] {
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
            PadPracticeLayout.arrange(
                size: Self.landscape, hasReading: true, readingHidden: false, isAccessibilitySize: true)
                == .stacked)
    }

    @Test func portraitGivesReadingTheLargerShare() {
        #expect(PadPracticeLayout.stackedPracticeShare(Self.portrait) < 0.5)
    }

    @Test func landscapeStackedForLargeTextKeepsPracticeTheLargerShare() {
        #expect(PadPracticeLayout.stackedPracticeShare(Self.landscape) > 0.5)
    }

    @Test func bothKindsShowTheControlScansFirst() {
        let both = ReadingPaneContent(tuneID: "tune1", scans: [Self.scan], lyrics: "Words")
        let scansOnly = ReadingPaneContent(tuneID: "tune1", scans: [Self.scan], lyrics: nil)
        let lyricsOnly = ReadingPaneContent(tuneID: "tune1", scans: [], lyrics: "Words")
        #expect(ReadingChoice.segments(both) == [.scans, .lyrics])
        #expect(ReadingChoice.segments(scansOnly).isEmpty)
        #expect(ReadingChoice.segments(lyricsOnly).isEmpty)
    }
}

/// The iPad practice screen reports `pad_practice_opened` and its screen once per visit to an item, though a size
/// change that swaps the shell takes it away and brings it back.
@MainActor
@Suite struct PadPracticeVisitTests {
    let reel = PlayerItem(kind: .recording, id: "r1", title: "Reel")
    let jig = PlayerItem(kind: .recording, id: "r2", title: "Jig")

    @Test func aPadPracticeScreenBackFromASizeChangeIsTheSameVisit() {
        let visit = PadPracticeVisit()
        #expect(!visit.binding(for: reel).wrappedValue)
        visit.binding(for: reel).wrappedValue = true

        #expect(visit.binding(for: reel).wrappedValue)
    }

    @Test func anotherItemIsANewVisit() {
        let visit = PadPracticeVisit()
        visit.binding(for: reel).wrappedValue = true

        #expect(!visit.binding(for: jig).wrappedValue)
    }

    @Test func closingThePlayerEndsTheVisit() {
        let visit = PadPracticeVisit()
        visit.binding(for: reel).wrappedValue = true
        visit.binding(for: reel).wrappedValue = false

        #expect(!visit.binding(for: reel).wrappedValue)
    }

    @Test func endsOnlyWhenThePlayerNoLongerShowsTheItem() {
        #expect(!PadPracticeVisit.ends(isExpanded: true, hasItem: true))
        #expect(PadPracticeVisit.ends(isExpanded: false, hasItem: true))
        #expect(PadPracticeVisit.ends(isExpanded: true, hasItem: false))
    }
}
