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

    @Test func reportsEachScanStoredWithHowItCameIn() async throws {
        let store = try root.open()
        let model = TuneModel(store: store, tuneID: try await tune(store), analytics: sink.client)

        await model.scans.add(
            [
                ScanPick(name: "page 1") { prepared },
                ScanPick.data(name: "broken.heic") { Data([0x00, 0x01]) },
                ScanPick(name: "page 2") { prepared },
            ], via: .documentScanner)

        #expect(
            sink.captures
                == Array(
                    repeating: .init(name: "scan_added", properties: ["via": .string("document_scanner")]), count: 2))
    }

    @Test func reportsAPhotoFromTheLibrary() async throws {
        let store = try root.open()
        let model = TuneModel(store: store, tuneID: try await tune(store), analytics: sink.client)

        await model.scans.add([ScanPick(name: "Photo 1") { prepared }], via: .photoLibrary)

        #expect(sink.captures == [.init(name: "scan_added", properties: ["via": .string("photo_library")])])
    }

    @Test func reportsEachOpeningOfTheScanViewer() {
        let log = ScanViewLog(writer: ScanViewWriter { _ in }, analytics: sink.client)
        let first = ScanRequest(tuneID: "t1", startIndex: 0, origin: .tune)
        let second = ScanRequest(tuneID: "t2", startIndex: 0, origin: .row)

        log.follow(from: nil, to: first)
        log.follow(from: first, to: first)
        log.follow(from: first, to: second)
        log.follow(from: second, to: nil)

        #expect(sink.captures == Array(repeating: .init(name: "scan_viewed", properties: [:]), count: 2))
    }

    @Test func theStandsReadingPaneReportsEachKindOnceAVisit() {
        var visit = ReadingVisit()
        let shown: [ReadingChoice] = [.scans, .lyrics, .scans, .lyrics]

        #expect(shown.map { visit.shown($0) } == [.scanViewed, .lyricsOpened, nil, nil])
    }

    @Test func reportsTheLyricsReaderOnceAsItShowsTheWords() async throws {
        let store = try root.open()
        let model = LyricsReaderModel(store: store, tuneID: try await tune(store), analytics: sink.client)
        #expect(try await poll { model.phase != .loading })

        model.shown()
        model.shown()

        #expect(sink.captures == [.init(name: "lyrics_opened", properties: [:])])
    }
}
