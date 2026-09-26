import CoreGraphics
import CrosstuneStore
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

@Suite struct StatusRailTests {
    @Test func aRequiredRailNeverClears() {
        #expect(StatusRail.pressing("known", current: "known", required: true) == "known")
        #expect(StatusRail.pressing("learning", current: "known", required: true) == "learning")
    }

    @Test func aFilterClearsWhenItsChosenStatusIsPressedAgain() {
        #expect(StatusRail.pressing("known", current: "known", required: false) == nil)
        #expect(StatusRail.pressing("known", current: nil, required: false) == "known")
        #expect(StatusRail.pressing(nil, current: "known", required: false) == nil)
    }

    @Test func anUnreadableStatusShowsAsWantToLearnOrAll() {
        #expect(StatusRail.chosen("mastered", required: true) == "want_to_learn")
        #expect(StatusRail.chosen("mastered", required: false) == nil)
        #expect(StatusRail.chosen("learning", required: false) == "learning")
        #expect(StatusRail.chosen(nil, required: false) == nil)
    }
}

@Suite struct FlowLayoutTests {
    private let pill = CGSize(width: 40, height: 20)

    @Test func wrapsWhenTheNextItemWouldNotFit() {
        let (origins, size) = FlowLayout.arrange(
            sizes: [pill, pill, pill], maxWidth: 100, spacing: 8, lineSpacing: 4)
        #expect(origins == [CGPoint(x: 0, y: 0), CGPoint(x: 48, y: 0), CGPoint(x: 0, y: 24)])
        #expect(size == CGSize(width: 88, height: 44))
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
}

@Suite struct MediaRowTests {
    @Test func namesTheRowByItsVerbAndItsLines() {
        #expect(
            MediaRow.accessibilityName(verb: "Play", title: "Jam", details: ["0:42 · Mar 14"])
                == "Play Jam, 0:42 · Mar 14")
        #expect(
            MediaRow.accessibilityName(verb: "Retry uploading", title: "Jam", details: ["0:42", "Refused"])
                == "Retry uploading Jam, 0:42, Refused")
        #expect(MediaRow.accessibilityName(verb: nil, title: "Jam", details: []) == "Jam")
    }
}

@Suite struct UndoBannerTests {
    @Test func staysLongerWhileVoiceOverRuns() {
        #expect(UndoBanner.timeout(voiceOver: false) == .seconds(8))
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
