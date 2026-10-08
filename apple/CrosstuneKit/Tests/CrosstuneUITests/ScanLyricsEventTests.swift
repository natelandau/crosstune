import CoreGraphics
import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// A small JPEG, so a pick prepares quickly.
private let prepared: PreparedScan = {
    let context = CGContext(
        data: nil, width: 17, height: 22, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    context.setFillColor(gray: 0.5, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: 17, height: 22))
    return try! PreparedScan.make(from: context.makeImage()!)
}()

/// Scans report each one stored with how it came in, and each opening of the viewer; the lyrics
/// reader reports each opening on words.
@MainActor
@Suite struct ScanLyricsEventTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private func tune(_ store: CrosstuneStore) async throws -> String {
        try await Commands(store: store).createTune(
            TuneInput(title: "Soldier's Joy", lyrics: "Grasshopper sitting on a sweet potato vine"),
            userTune: UserTuneInput(status: "known"), at: noon
        ).tuneID
    }

    private func added(_ via: String, tuneID: String, in store: CrosstuneStore) async throws
        -> [RecordingAnalyticsSink.Capture]
    {
        try await store.read { try Scan.fetch($0, tuneID: tuneID) }.map {
            .init(
                name: "scan_added",
                properties: ["via": .string(via), "scan_id": .string($0.id), "tune_id": .string(tuneID)])
        }
    }

    @Test func reportsEachScanStoredWithHowItCameIn() async throws {
        let store = try root.open()
        let tuneID = try await tune(store)
        let model = TuneModel(store: store, tuneID: tuneID, analytics: sink.client)

        await model.scans.add(
            [
                ScanPick(name: "page 1") { prepared },
                ScanPick.data(name: "broken.heic") { Data([0x00, 0x01]) },
                ScanPick(name: "page 2") { prepared },
            ], via: .documentScanner)

        let expected = try await added("document_scanner", tuneID: tuneID, in: store)
        #expect(expected.count == 2)
        #expect(sink.captures == expected)
    }

    @Test func reportsAPhotoFromTheLibrary() async throws {
        let store = try root.open()
        let tuneID = try await tune(store)
        let model = TuneModel(store: store, tuneID: tuneID, analytics: sink.client)

        await model.scans.add([ScanPick(name: "Photo 1") { prepared }], via: .photoLibrary)

        let expected = try await added("photo_library", tuneID: tuneID, in: store)
        #expect(expected.count == 1)
        #expect(sink.captures == expected)
    }

    @Test func reportsEachOpeningOfTheScanViewer() {
        let log = ScanViewLog(writer: ScanViewWriter { _ in }, analytics: sink.client)
        let first = ScanRequest(tuneID: "t1", startIndex: 0, origin: .tune)
        let second = ScanRequest(tuneID: "t2", startIndex: 0, origin: .row)

        log.follow(from: nil, to: first)
        log.follow(from: first, to: first)
        log.follow(from: first, to: second)
        log.follow(from: second, to: nil)

        #expect(
            sink.captures == ["t1", "t2"].map { .init(name: "scan_viewed", properties: ["tune_id": .string($0)]) })
    }

    @Test func theStandsReadingPaneReportsEachKindOnceAVisit() {
        let visit = StandVisit()
        let picked: [ReadingChoice] = [.lyrics, .scans, .lyrics]

        #expect(visit.readingShown(.scans, tuneID: "t1", picked: false) == .scanViewed(tuneID: "t1"))
        #expect(
            picked.map { visit.readingShown($0, tuneID: "t1", picked: true) } == [
                .lyricsOpened(tuneID: "t1"), nil, nil,
            ])
    }

    /// A playlist moving on shows the next tune's reading by itself, which is not a view the
    /// musician asked for; a segment picked on that tune is.
    @Test func theStandsReadingPaneReportsNoTuneTheListMovedTo() {
        let visit = StandVisit()

        #expect(visit.readingShown(.scans, tuneID: "t1", picked: false) == .scanViewed(tuneID: "t1"))
        #expect(visit.readingShown(.scans, tuneID: "t2", picked: false) == nil)
        #expect(visit.readingShown(.lyrics, tuneID: "t3", picked: false) == nil)
        #expect(visit.readingShown(.lyrics, tuneID: "t3", picked: true) == .lyricsOpened(tuneID: "t3"))
        #expect(visit.readingShown(.scans, tuneID: "t3", picked: true) == .scanViewed(tuneID: "t3"))
        #expect(visit.readingShown(.scans, tuneID: "t1", picked: false) == nil)

        visit.ended()

        #expect(visit.readingShown(.lyrics, tuneID: "t4", picked: false) == .lyricsOpened(tuneID: "t4"))
    }

    @Test func reportsTheLyricsReaderOnceAsItShowsTheWords() async throws {
        let store = try root.open()
        let tuneID = try await tune(store)
        let model = LyricsReaderModel(store: store, tuneID: tuneID, analytics: sink.client)
        #expect(try await poll { model.phase != .loading })

        model.shown()
        model.shown()

        #expect(sink.captures == [.init(name: "lyrics_opened", properties: ["tune_id": .string(tuneID)])])
    }

    @Test func deletingAScanReportsItsIDAndTune() async throws {
        let store = try root.open()
        let tuneID = try await tune(store)
        let adding = TuneModel(store: store, tuneID: tuneID)
        await adding.scans.add([ScanPick(name: "page 1") { prepared }], via: .photoLibrary)
        let scanID = try #require(try await store.read { try Scan.fetch($0, tuneID: tuneID) }.first?.id)
        let model = TuneModel(store: store, tuneID: tuneID, analytics: sink.client)

        await model.scans.delete(scanID)

        #expect(
            sink.captures == [
                .init(name: "scan_deleted", properties: ["scan_id": .string(scanID), "tune_id": .string(tuneID)])
            ])
    }

    @Test func deletingAScanFromTheViewerReportsIt() async throws {
        let store = try root.open()
        let tuneID = try await tune(store)
        let adding = TuneModel(store: store, tuneID: tuneID)
        await adding.scans.add([ScanPick(name: "page 1") { prepared }], via: .photoLibrary)
        let scanID = try #require(try await store.read { try Scan.fetch($0, tuneID: tuneID) }.first?.id)
        let viewer = ScanViewerModel(store: store, tuneID: tuneID, analytics: sink.client)

        await viewer.delete(scanID)

        #expect(
            sink.captures == [
                .init(name: "scan_deleted", properties: ["scan_id": .string(scanID), "tune_id": .string(tuneID)])
            ])
    }

    @Test func reorderingScansReportsTheTuneOnceTheMoveLands() async throws {
        let store = try root.open()
        let tuneID = try await tune(store)
        let adding = TuneModel(store: store, tuneID: tuneID)
        await adding.scans.add(
            [ScanPick(name: "page 1") { prepared }, ScanPick(name: "page 2") { prepared }], via: .photoLibrary)
        let model = TuneModel(store: store, tuneID: tuneID, analytics: sink.client)
        #expect(try await poll { model.scans.scans.count == 2 })

        model.scans.move(from: 0, to: 1)

        #expect(
            try await poll {
                sink.captures == [.init(name: "scans_reordered", properties: ["tune_id": .string(tuneID)])]
            })
    }

    @Test func theStandReportsOnlyTheFirstTuneOfAVisit() {
        let visit = StandVisit()

        #expect(
            [visit.opened(tuneID: "t1"), visit.opened(tuneID: "t1"), visit.opened(tuneID: "t2")] == [
                .standOpened(tuneID: "t1"), nil, nil,
            ])

        visit.ended()

        #expect(visit.opened(tuneID: "t2") == .standOpened(tuneID: "t2"))
    }
}
