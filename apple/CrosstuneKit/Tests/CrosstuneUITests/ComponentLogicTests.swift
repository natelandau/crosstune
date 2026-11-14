import CoreGraphics
import CrosstuneDesign
import CrosstuneStore
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

struct FlowLayoutTests {
    private let pill = CGSize(width: 40, height: 20)

    @Test func wrapsWhenTheNextItemWouldNotFit() {
        let (origins, size) = FlowLayout.arrange(
            sizes: [pill, pill, pill], maxWidth: 100, spacing: 8, lineSpacing: 4)
        #expect(origins == [CGPoint(x: 0, y: 0), CGPoint(x: 48, y: 0), CGPoint(x: 0, y: 24)])
        #expect(size == CGSize(width: 88, height: 44))
    }

    @Test func fillsALineToTheExactWidthBeforeWrapping() {
        let half = CGSize(width: 46, height: 20)
        let fits = FlowLayout.arrange(sizes: [half, half], maxWidth: 100, spacing: 8, lineSpacing: 4)
        #expect(fits.origins == [CGPoint(x: 0, y: 0), CGPoint(x: 54, y: 0)])
        let wraps = FlowLayout.arrange(sizes: [half, half], maxWidth: 99.5, spacing: 8, lineSpacing: 4)
        #expect(wraps.origins == [CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 24)])
    }

    @Test func centersShorterItemsOnTheirLine() {
        let (origins, size) = FlowLayout.arrange(
            sizes: [CGSize(width: 40, height: 44), pill], maxWidth: nil, spacing: 8, lineSpacing: 4)
        #expect(origins == [CGPoint(x: 0, y: 0), CGPoint(x: 48, y: 12)])
        #expect(size == CGSize(width: 88, height: 44))
    }

    @Test func givesAnOversizedItemALineOfItsOwn() {
        let (origins, _) = FlowLayout.arrange(
            sizes: [pill, CGSize(width: 300, height: 20), pill], maxWidth: 100, spacing: 8, lineSpacing: 0)
        #expect(origins.map(\.y) == [0, 20, 40])
    }

    @Test func isEmptyWithNothingToLayOut() {
        #expect(FlowLayout.arrange(sizes: [], maxWidth: 100, spacing: 8, lineSpacing: 8).size == .zero)
    }

    /// A label whose ideal width is 300 and that wraps to two lines of 100 when narrowed.
    private func label(at width: CGFloat?) -> CGSize {
        guard let width, width < 300 else { return CGSize(width: 300, height: 20) }
        return CGSize(width: min(width, 100), height: 40)
    }

    private func measured(proposal: CGFloat?) -> (origins: [CGPoint], size: CGSize) {
        let sizes = FlowLayout.itemSizes(count: 3, width: proposal) { index, width in
            index == 1 ? label(at: width) : pill
        }
        return FlowLayout.arrange(sizes: sizes, maxWidth: proposal, spacing: 8, lineSpacing: 4)
    }

    @Test(arguments: [nil, 120, 100, 200] as [CGFloat?])
    func placesAtTheWidthItMeasuredWith(proposal: CGFloat?) {
        let measuredResult = measured(proposal: proposal)
        // The parent places at the size it was given, and may pass no proposal.
        for placementProposal in [nil, measuredResult.size.width] {
            let width = FlowLayout.wrapWidth(proposal: placementProposal, bounds: measuredResult.size.width)
            let placed = measured(proposal: width)
            #expect(placed.size == measuredResult.size)
        }
    }

    @Test func neverWrapsPastTheBounds() {
        #expect(FlowLayout.wrapWidth(proposal: 100, bounds: 150) == 100)
        #expect(FlowLayout.wrapWidth(proposal: 100, bounds: 80) == 80)
        #expect(FlowLayout.wrapWidth(proposal: .infinity, bounds: 120) == 120)
        #expect(FlowLayout.wrapWidth(proposal: nil, bounds: 120) == 120)
    }
}

struct MediaRowTests {
    @Test func namesTheRowByItsActionLabelAndItsLines() {
        #expect(
            MediaRow.accessibilityName(actionLabel: "Play", title: "Jam", details: ["0:42 · Mar 14"])
                == "Play Jam, 0:42 · Mar 14")
        #expect(
            MediaRow.accessibilityName(actionLabel: "Retry uploading", title: "Jam", details: ["0:42", "Refused"])
                == "Retry uploading Jam, 0:42, Refused")
        #expect(MediaRow.accessibilityName(actionLabel: nil, title: "Jam", details: []) == "Jam")
    }
}

struct UndoBannerTests {
    @Test func staysLongerWhileVoiceOverRuns() {
        #expect(UndoBanner.timeout(voiceOver: true) > UndoBanner.timeout(voiceOver: false))
    }
}

@Suite struct SampleCatalogTests {
    @Test func fillsAStoreWithEveryKindOfRow() async throws {
        let store = try await SampleCatalog.makeStore()
        defer { try? FileManager.default.removeItem(at: store.folder.deletingLastPathComponent()) }
        let counts = try await store.read { db in
            (
                try Tune.fetchCount(db), try UserTune.fetchCount(db), try TuneList.fetchCount(db),
                try ListItem.fetchCount(db), try RecordingLink.fetchCount(db), try Recording.fetchCount(db),
                try RecordingFile.fetchCount(db), try UserSettings.fetchCount(db)
            )
        }
        #expect(counts.0 == SampleCatalog.entries.count)
        #expect(counts.1 == SampleCatalog.entries.count)
        #expect(counts.2 == SampleCatalog.lists.count)
        #expect(counts.3 == SampleCatalog.listItems.count)
        #expect(counts.4 == SampleCatalog.links.count)
        #expect(counts.5 == SampleCatalog.recordings.count)
        #expect(counts.6 == SampleCatalog.recordings.compactMap(\.file).count + SampleCatalog.unfinishedCaptures.count)
        #expect(counts.7 == 1)
        try store.close()
    }

    @Test func coversEveryRowControlAndBothRetries() {
        let rows = SampleCatalog.recordingRows
        let controls = Set(rows.map { "\($0.control)" })
        #expect(controls.isSuperset(of: ["play", "download", "none"]))
        #expect(rows.contains { $0.retry == .upload && $0.error != nil })
        #expect(rows.contains { $0.retry == .transcode })
    }
}

struct SpacingTests {
    @Test func theDefaultSizeIsUnscaled() {
        #expect(Spacing(.large).scale == 1)
        #expect(Spacing(.large)(10) == 10)
    }

    @Test func tokensScaleAsBodyTextDoes() {
        #expect(Spacing(.small)(10) == 9)
        #expect(Spacing(.xLarge)(10) == 11)
        #expect(Spacing(.accessibility3)(10) == 23.5)
        #expect(Spacing(.small)(12) == 10.5)
    }

    @Test func theTapOutsetMakesUpToTheMinimum() {
        #expect(tapOutset(visibleHeight: 28, minimum: 44) == 8)
        #expect(tapOutset(visibleHeight: 50, minimum: 44) == 0)
    }

    @Test func theMinimumTapTargetIsPointerSizedOnTheMac() {
        #if os(macOS)
            #expect(minimumTapTarget == 28)
        #else
            #expect(minimumTapTarget == 44)
        #endif
    }
}

struct CharacterLimitTests {
    @Test func countsCodePointsAsTheServerDoes() {
        // Each flag is one character of two code points.
        let flags = String(repeating: "🇺🇸", count: 3)
        #expect(CharacterLimit.capped(flags, limit: 5) == String(repeating: "🇺🇸", count: 2))
        #expect(CharacterLimit.capped(flags, limit: 6) == nil)
    }

    @Test func leavesTextWithinTheLimitOrWithNoLimit() {
        #expect(CharacterLimit.capped("Galax", limit: 5) == nil)
        #expect(CharacterLimit.capped("Galax", limit: nil) == nil)
        #expect(CharacterLimit.capped("Galax, VA", limit: 5) == "Galax")
    }
}
