import CoreGraphics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}

private func makeTune(_ store: CrosstuneStore, _ title: String = "Soldier's Joy") async throws -> String {
    try await Commands(store: store).createTune(
        TuneInput(title: title), userTune: UserTuneInput(status: "known"), at: noon
    ).tuneID
}

/// A small scan, prepared once, so many can be written quickly.
private let preparedScan = try! PreparedScan.make(from: jpeg(width: 17, height: 22))

private func record(state: String = "ready", width: Int = 1700, height: Int = 2200) -> ScanRecord {
    ScanRecord(
        id: UUID().uuidString, createdAt: noon, tuneID: "tune", position: 0, width: width, height: height
    )
    .with(state: state)
}

extension ScanRecord {
    fileprivate func with(state: String) -> ScanRecord {
        var copy = self
        copy.state = state
        return copy
    }
}

/// A real JPEG of the given size, for the thumbnail decoder.
private func jpeg(width: Int, height: Int) -> Data {
    let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    context.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let output = NSMutableData()
    let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    precondition(CGImageDestinationFinalize(destination))
    return output as Data
}

@MainActor
@Suite struct ScansUITests {
    // MARK: Section

    @Test func testSectionShowsAddWithNoScans() {
        let layout = ScansSectionLayout(scanCount: 0)

        #expect(layout.showsEmptyState)
        #expect(layout.canAdd)
        #expect(!layout.showsEdit)
        #expect(layout.limitNote == nil)
    }

    @Test func testAddDisabledAtTwentyScans() {
        let almost = ScansSectionLayout(scanCount: 19)
        #expect(almost.canAdd)
        #expect(almost.limitNote == nil)
        #expect(almost.showsEdit)

        let full = ScansSectionLayout(scanCount: maxScansPerTune)
        #expect(!full.canAdd)
        #expect(full.limitNote == ScanCopy.limitNote)
        #expect(!full.showsEmptyState)
    }

    @Test func testStorageFullScanIsMarked() {
        let pending = record(state: ScanRecord.pendingUpload)
        let full = Scan(
            record: pending,
            file: ScanFile(
                scanID: pending.id, fileName: "a.jpg", origin: .captured, error: ScanFile.storageFullError))
        #expect(ScanCopy.status(for: full) == ScanCopy.storageFull)

        let refused = Scan(
            record: pending,
            file: ScanFile(
                scanID: pending.id, fileName: "a.jpg", origin: .captured, error: ScanFile.refusedError))
        #expect(ScanCopy.status(for: refused) == ScanCopy.refused)

        let tooLarge = Scan(
            record: pending,
            file: ScanFile(
                scanID: pending.id, fileName: "a.jpg", origin: .captured, error: "HTTP 413: File too large"))
        #expect(ScanCopy.status(for: tooLarge) == ScanCopy.notUploaded)

        let blank = Scan(
            record: pending,
            file: ScanFile(scanID: pending.id, fileName: "a.jpg", origin: .captured, error: ""))
        #expect(ScanCopy.status(for: blank) == nil)

        #expect(ScanCopy.status(for: Scan(record: pending, file: nil)) == ScanCopy.waiting)

        let ready = record()
        #expect(ScanCopy.status(for: Scan(record: ready, file: nil)) == nil)
        #expect(
            ScanCopy.status(
                for: Scan(
                    record: ready, file: ScanFile(scanID: ready.id, fileName: "b.jpg", origin: .downloaded)))
                == nil)
    }

    // Literal on purpose: these pin the words to web/src/features/scans/scanCopy.ts, which
    // the web's end-to-end specs query by name, so the two clients never drift apart.
    @Test func labelsMatchTheWebClient() {
        #expect(ScanCopy.scans == "Scans")
        #expect(ScanCopy.addScans == "Add scans")
        #expect(ScanCopy.emptyTitle == "No scans yet")
        #expect(ScanCopy.emptyHint == "Add a photo of written music, lyrics, or notes.")
        #expect(ScanCopy.deleteTitle == "Delete this scan?")
        #expect(ScanCopy.unreadableScan == "This scan cannot be shown")
        #expect(ScanCopy.scan(0) == "Scan 1")
        #expect(ScanCopy.moveScan(0) == "Move scan 1")
        #expect(ScanCopy.deleteScan(0) == "Delete scan 1")
        #expect(ScanCopy.invert == "Invert")
        #expect(ScanCopy.limitNote == "A tune holds up to 20 scans.")
        #expect(ScanCopy.storageFull == "Not uploaded, storage full")
        #expect(ScanCopy.refused == "Could not upload. Delete this scan and add it again.")
        #expect(ScanCopy.waiting == "Waiting for upload from another device")
        #expect(ScanCopy.notUploaded == "Not uploaded yet")
    }

    // The web adds scans through one file picker, so these choices have no web counterpart.
    @Test func addChoiceLabels() {
        #expect(ScanAddChoice.scan.label == "Scan")
        #expect(ScanAddChoice.photo.label == "Choose Photo")
        #expect(ScanAddChoice.file.label == "Choose File")
    }

    @Test func numberedAndCountedCopy() {
        #expect(ScanCopy.scanCount(index: 1, total: 3) == "2 of 3")
        #expect(ScanCopy.openScan(0) == "Open scan 1")
        #expect(ScanCopy.deleteScan(2) == "Delete scan 3")
        #expect(ScanCopy.scansNotAdded(1) == "1 scan was not added. \(ScanCopy.limitNote)")
        #expect(ScanCopy.scansNotAdded(3) == "3 scans were not added. \(ScanCopy.limitNote)")
        #expect(ScanCopy.unreadable(["a.heic"]) == "\"a.heic\" is not an image Crosstune can read.")
        #expect(
            ScanCopy.unreadable(["a.heic", "b.tiff", "c.pdf"])
                == "\"a.heic\", \"b.tiff\", and \"c.pdf\" are not images Crosstune can read.")
    }

    // MARK: Add menu

    @Test func testScanHiddenWhenUnsupported() {
        #expect(ScanAddChoice.available(scanSupported: false, photoLibrary: true) == [.photo, .file])
        #expect(ScanAddChoice.available(scanSupported: true, photoLibrary: true) == [.scan, .photo, .file])
        // The Mac offers neither the camera nor the photo library.
        #expect(ScanAddChoice.available(scanSupported: false, photoLibrary: false) == [.file])
    }

    // MARK: Row action

    @Test func testRowOffersScansOnlyWithScans() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let withScans = try await makeTune(store, "Soldier's Joy")
        let without = try await makeTune(store, "Cluck Old Hen")
        let emptied = try await makeTune(store, "Kitchen Girl")
        try await commands.addScans(tuneID: withScans, scans: [preparedScan], at: noon)
        let gone = try await commands.addScans(tuneID: emptied, scans: [preparedScan], at: noon)
        try await commands.deleteScan(gone[0], at: later(1))

        let tunes = try await store.read { db in try ScanTunes.fetch(db) }

        #expect(tunes == [withScans])
        #expect(TuneRowActions.scansAction(tuneID: withScans, tunesWithScans: tunes) { _ in } != nil)
        #expect(TuneRowActions.scansAction(tuneID: without, tunesWithScans: tunes) { _ in } == nil)
        #expect(TuneRowActions.scansAction(tuneID: emptied, tunesWithScans: tunes) { _ in } == nil)
    }

    // MARK: Viewer

    @Test func testViewerOpensAtStartIndex() {
        let ids = ["a", "b", "c"]
        #expect(ScanPager.initialScan(ids: ids, startIndex: 0) == "a")
        #expect(ScanPager.initialScan(ids: ids, startIndex: 2) == "c")
        // A scan deleted between the tap and the open still lands on a scan.
        #expect(ScanPager.initialScan(ids: ids, startIndex: 7) == "c")
        #expect(ScanPager.initialScan(ids: [], startIndex: 0) == nil)
        #expect(ScanPager.indicator(shown: "b", ids: ids) == "2 of 3")
        // A scan that left the tune shows the nearest one's count rather than nothing.
        #expect(ScanPager.indicator(shown: "gone", ids: ids) == "1 of 3")
    }

    @Test func zoomTogglesBetweenFitAndTwice() {
        #expect(ScanZoom.toggled(1) == 2)
        #expect(ScanZoom.toggled(2) == 1)
        #expect(ScanZoom.toggled(3.4) == 1)
        #expect(ScanZoom.clamped(0.5) == 1)
        #expect(ScanZoom.clamped(9) == ScanZoom.maximum)
    }

    @Test func aPanStaysWithinTheZoomedScan() {
        // A portrait scan fitted to a 400 by 400 box is 300 wide, so at 2x it overflows by 100 on
        // each side across and by 200 up and down.
        let box = CGSize(width: 400, height: 400)
        let far = CGSize(width: 900, height: -900)
        #expect(
            ScanZoom.clampedOffset(far, container: box, aspectRatio: 0.75, scale: 2)
                == CGSize(width: 100, height: -200))
        #expect(
            ScanZoom.clampedOffset(CGSize(width: 40, height: 50), container: box, aspectRatio: 0.75, scale: 2)
                == CGSize(width: 40, height: 50))
        // At 1.2x the scan is still narrower than the box, so it cannot move sideways.
        #expect(
            ScanZoom.clampedOffset(far, container: box, aspectRatio: 0.75, scale: 1.2).width == 0)
        #expect(ScanZoom.clampedOffset(far, container: box, aspectRatio: 0.75, scale: 1) == .zero)
        #expect(ScanZoom.clampedOffset(far, container: .zero, aspectRatio: 0.75, scale: 2) == .zero)
    }

    @Test func aPanPastTheNewEdgeComesBackWhenTheContainerTurns() {
        // A portrait scan at 2x on a portrait phone overflows by 195 across and 98 up and down;
        // turned to landscape, the scan no longer overflows across at all.
        let portrait = CGSize(width: 390, height: 844)
        let landscape = CGSize(width: 844, height: 390)
        let panned = ScanZoom.clampedOffset(
            CGSize(width: 900, height: 900), container: portrait, aspectRatio: 0.75, scale: 2)
        #expect(panned == CGSize(width: 195, height: 98))
        #expect(
            ScanZoom.clampedOffset(panned, container: landscape, aspectRatio: 0.75, scale: 2)
                == CGSize(width: 0, height: 98))
    }

    // MARK: Thumbnails

    @Test func regularWidthScansGrow() {
        #if os(iOS)
            #expect(ScansSection.thumbnailHeight(regular: true) == PadStyle.scanThumbnailHeight)
            #expect(ScansSection.thumbnailHeight(regular: true) > ScansSection.thumbnailHeight(regular: false))
        #else
            #expect(ScansSection.thumbnailHeight(regular: true) == 120)
        #endif
        #expect(ScansSection.thumbnailHeight(regular: false) == 120)
    }

    @Test func thumbnailsDecodeAtTheirPixelHeightAndNeverUpscale() throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let tall = root.url.appending(path: "tall.jpg")
        try jpeg(width: 600, height: 900).write(to: tall)
        // A 120 pt row and a 180 pt tile, on a 2x screen.
        #expect(ScanThumbnail.pixelHeight(height: 120, scale: 2) == 240)
        #expect(ScanThumbnail.pixelHeight(height: 180, scale: 2) == 360)
        let image = try #require(ScanThumbnail.decode(tall, height: 240))
        #expect(image.height == 240)
        #expect(image.width == 160)
        let large = try #require(ScanThumbnail.decode(tall, height: 360))
        #expect(large.height == 360)
        #expect(large.width == 240)

        let small = root.url.appending(path: "small.jpg")
        try jpeg(width: 100, height: 50).write(to: small)
        let kept = try #require(ScanThumbnail.decode(small, height: 240))
        #expect(kept.height == 50)
        #expect(kept.width == 100)

        let broken = root.url.appending(path: "broken.jpg")
        try Data([0x00, 0x01]).write(to: broken)
        #expect(ScanThumbnail.decode(broken, height: 240) == nil)
    }

    @MainActor
    @Test func aThumbnailStillShowsAfterTheCacheIsEmptied() async throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "scan.jpg")
        try jpeg(width: 300, height: 400).write(to: url)
        let cache = ThumbnailCache(countLimit: 10)

        let first = try #require(await ScanThumbnail.load(key: "p/scan.jpg", url: url, pixelHeight: 240, cache: cache))
        // A second load is a cache hit, and still hands back the image for the view to keep.
        try FileManager.default.removeItem(at: url)
        let hit = try #require(await ScanThumbnail.load(key: "p/scan.jpg", url: url, pixelHeight: 240, cache: cache))
        #expect(hit === first)

        cache.removeAll()

        let decoded: (key: String, image: CGImage?) = ("p/scan.jpg", hit)
        #expect(ScanThumbnail.shown(key: "p/scan.jpg", decoded: decoded, cache: cache) === first)
        #expect(ScanThumbnail.shown(key: "other/scan.jpg", decoded: decoded, cache: cache) == nil)
    }

    @Test func thumbnailKeyFollowsTheScanAndItsFile() {
        let scan = record()
        let first = ScanFile(scanID: scan.id, fileName: "a.jpg", origin: .captured)
        var retried = first
        retried.uploadAttempts = 3
        let downloaded = ScanFile(scanID: scan.id, fileName: "b.jpg", origin: .downloaded)
        // A file row that changes only its upload bookkeeping keeps its decoded image.
        #expect(ScanThumbnail.key(scan: scan, file: first) == ScanThumbnail.key(scan: scan, file: retried))
        #expect(ScanThumbnail.key(scan: scan, file: first) != ScanThumbnail.key(scan: scan, file: downloaded))
        // The same file at another decoded size is another image.
        #expect(
            ScanThumbnail.thumbnailKey(scan: scan, file: first, pixelHeight: 240)
                != ScanThumbnail.thumbnailKey(scan: scan, file: first, pixelHeight: 360))
    }

    // MARK: Adding, moving, deleting

    @MainActor
    @Test func addsUpToTheLimitAndSaysHowManyWereLeftOut() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        try await Commands(store: store).addScans(
            tuneID: tuneID, scans: Array(repeating: preparedScan, count: 18), at: noon)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.scans.scans.count == 18 }

        let picks = (0..<5).map { index in ScanPick(name: "scan \(index)") { preparedScan } }
        await model.scans.add(picks, via: .file)

        try await eventually { model.scans.scans.count == maxScansPerTune }
        #expect(model.scans.failure == ScanCopy.scansNotAdded(3))
        #expect(!model.scans.isAdding)
    }

    @MainActor
    @Test func namesAnUnreadableImageAndAddsTheRest() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.shown != nil }

        await model.scans.add(
            [
                ScanPick(name: "first.jpg") { preparedScan },
                ScanPick.data(name: "broken.heic") { Data([0x00, 0x01, 0x02]) },
                ScanPick(name: "third.jpg") { preparedScan },
            ], via: .file)

        try await eventually { model.scans.scans.count == 2 }
        #expect(model.scans.failure == ScanCopy.unreadable(["broken.heic"]))
    }

    @MainActor
    @Test func aPickedFileAddsAScanNamedByItsFileName() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.shown != nil }
        let picked = root.url.appending(path: "reel.jpg")
        try jpeg(width: 300, height: 400).write(to: picked)
        let missing = root.url.appending(path: "gone.png")

        await model.scans.add([ScanPick.file(picked), ScanPick.file(missing)], via: .file)

        try await eventually { model.scans.scans.count == 1 }
        let scan = try #require(model.scans.scans.first)
        #expect(scan.record.width == 300)
        #expect(scan.record.height == 400)
        #expect(scan.file?.origin == .captured)
        #expect(model.scans.failure == ScanCopy.unreadable(["gone.png"]))
    }

    @MainActor
    @Test func aMoveShowsAtOnceAndLandsInTheStore() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        let ids = try await Commands(store: store).addScans(
            tuneID: tuneID, scans: [preparedScan, preparedScan, preparedScan], at: noon)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.scans.scans.count == 3 }

        model.scans.move(from: 0, to: 2)

        #expect(model.scans.scans.map(\.id) == [ids[1], ids[2], ids[0]])
        #expect(model.scans.announcement?.text == "Scan 1 moved to 3 of 3")
        let expected = [ids[1], ids[2], ids[0]]
        if try await !poll({ try await store.read { db in try db.liveScanOrder(tuneID: tuneID) } == expected }) {
            Issue.record("The move never reached the store")
        }
        // The replayed move retires once the store's read agrees, leaving the order as it was.
        try await eventually { model.scans.scans.map(\.id) == expected }
    }

    @MainActor
    @Test func aDeletedScanLeavesTheSection() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        let ids = try await Commands(store: store).addScans(
            tuneID: tuneID, scans: [preparedScan, preparedScan], at: noon)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.scans.scans.count == 2 }

        await model.scans.delete(ids[0])

        try await eventually { model.scans.scans.map(\.id) == [ids[1]] }
        #expect(model.scans.failure == nil)
    }

    @Test func deleteSaysWhetherAScanCanComeBack() {
        let pending = record(state: ScanRecord.pendingUpload)
        let captured = Scan(
            record: pending, file: ScanFile(scanID: pending.id, fileName: "a.jpg", origin: .captured))
        #expect(ScanCopy.deleteMessage(captured) == RecordingsModel.deleteUnsyncedNote)
        let ready = record()
        let downloaded = Scan(
            record: ready, file: ScanFile(scanID: ready.id, fileName: "a.jpg", origin: .downloaded))
        #expect(ScanCopy.deleteMessage(downloaded) == RecordingsModel.deleteSyncedNote)
    }
}

extension Database {
    fileprivate func liveScanOrder(tuneID: String) throws -> [String] {
        ScanRecord.sorted(
            try ScanRecord.filter(Column("tune_id") == tuneID && Column("deleted_at") == nil).fetchAll(self)
        ).map(\.id)
    }
}

@MainActor
@Suite struct ScanZoomSourceTests {
    @Test func theViewerClosesIntoTheThumbnailOfTheScanShowingNow() {
        let request = ScanRequest(tuneID: "t1", startIndex: 1, origin: .tune)
        #expect(ScanScreens.zoomSourceID(request, shownIndex: nil) == ScanScreens.sourceID(tuneID: "t1", index: 1))
        #expect(ScanScreens.zoomSourceID(request, shownIndex: 3) == ScanScreens.sourceID(tuneID: "t1", index: 3))
    }

    @Test func aRowOpensTheViewerWithoutAZoom() {
        let request = ScanRequest(tuneID: "t1", startIndex: 0, origin: .row)
        #expect(ScanScreens.zoomSourceID(request, shownIndex: 2) == nil)
    }
}
