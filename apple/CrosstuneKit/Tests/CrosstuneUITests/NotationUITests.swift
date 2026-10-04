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

/// A small page, prepared once, so many can be written quickly.
private let preparedPage = try! PreparedPage.make(from: jpeg(width: 17, height: 22))

private func record(state: String = "ready", width: Int = 1700, height: Int = 2200) -> NotationPageRecord {
    NotationPageRecord(
        id: UUID().uuidString, createdAt: noon, tuneID: "tune", position: 0, width: width, height: height
    )
    .with(state: state)
}

extension NotationPageRecord {
    fileprivate func with(state: String) -> NotationPageRecord {
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

@Suite struct NotationUITests {
    // MARK: Section

    @Test func testSectionShowsAddWithNoPages() {
        let layout = NotationSectionLayout(pageCount: 0)

        #expect(layout.showsEmptyState)
        #expect(layout.canAdd)
        #expect(!layout.showsEdit)
        #expect(layout.limitNote == nil)
    }

    @Test func testAddDisabledAtTwentyPages() {
        let almost = NotationSectionLayout(pageCount: 19)
        #expect(almost.canAdd)
        #expect(almost.limitNote == nil)
        #expect(almost.showsEdit)

        let full = NotationSectionLayout(pageCount: maxNotationPagesPerTune)
        #expect(!full.canAdd)
        #expect(full.limitNote == NotationCopy.limitNote)
        #expect(!full.showsEmptyState)
    }

    @Test func testStorageFullPageIsMarked() {
        let pending = record(state: NotationPageRecord.pendingUpload)
        let full = NotationPage(
            record: pending,
            file: NotationFile(
                pageID: pending.id, fileName: "a.jpg", origin: .captured, error: NotationFile.storageFullError))
        #expect(NotationCopy.status(for: full) == NotationCopy.storageFull)

        let refused = NotationPage(
            record: pending,
            file: NotationFile(
                pageID: pending.id, fileName: "a.jpg", origin: .captured, error: NotationFile.refusedError))
        #expect(NotationCopy.status(for: refused) == NotationCopy.refused)

        let tooLarge = NotationPage(
            record: pending,
            file: NotationFile(
                pageID: pending.id, fileName: "a.jpg", origin: .captured, error: "HTTP 413: File too large"))
        #expect(NotationCopy.status(for: tooLarge) == NotationCopy.notUploaded)

        let blank = NotationPage(
            record: pending,
            file: NotationFile(pageID: pending.id, fileName: "a.jpg", origin: .captured, error: ""))
        #expect(NotationCopy.status(for: blank) == nil)

        #expect(NotationCopy.status(for: NotationPage(record: pending, file: nil)) == NotationCopy.waiting)

        let ready = record()
        #expect(NotationCopy.status(for: NotationPage(record: ready, file: nil)) == nil)
        #expect(
            NotationCopy.status(
                for: NotationPage(
                    record: ready, file: NotationFile(pageID: ready.id, fileName: "b.jpg", origin: .downloaded)))
                == nil)
    }

    // Literal on purpose: these pin the words to web/src/features/notation/notationCopy.ts, which
    // the web's end-to-end specs query by name, so the two clients never drift apart.
    @Test func labelsMatchTheWebClient() {
        #expect(NotationCopy.notation == "Notation")
        #expect(NotationCopy.addNotation == "Add notation")
        #expect(NotationCopy.invert == "Invert")
        #expect(NotationCopy.limitNote == "A tune holds up to 20 pages.")
        #expect(NotationCopy.storageFull == "Not uploaded, storage full")
        #expect(NotationCopy.refused == "Could not upload. Delete this page and add it again.")
        #expect(NotationCopy.waiting == "Waiting for upload from another device")
        #expect(NotationCopy.notUploaded == "Not uploaded yet")
    }

    // The web adds pages through one file picker, so these choices have no web counterpart.
    @Test func addChoiceLabels() {
        #expect(NotationAddChoice.scan.label == "Scan")
        #expect(NotationAddChoice.photo.label == "Choose Photo")
        #expect(NotationAddChoice.file.label == "Choose File")
    }

    @Test func numberedAndCountedCopy() {
        #expect(NotationCopy.pageCount(index: 1, total: 3) == "2 of 3")
        #expect(NotationCopy.openPage(0) == "Open page 1")
        #expect(NotationCopy.deletePage(2) == "Delete page 3")
        #expect(NotationCopy.pagesNotAdded(1) == "1 page was not added. \(NotationCopy.limitNote)")
        #expect(NotationCopy.pagesNotAdded(3) == "3 pages were not added. \(NotationCopy.limitNote)")
        #expect(NotationCopy.unreadable(["a.heic"]) == "\"a.heic\" is not an image Crosstune can read.")
        #expect(
            NotationCopy.unreadable(["a.heic", "b.tiff", "c.pdf"])
                == "\"a.heic\", \"b.tiff\", and \"c.pdf\" are not images Crosstune can read.")
    }

    // MARK: Add menu

    @Test func testScanHiddenWhenUnsupported() {
        #expect(NotationAddChoice.available(scanSupported: false, photoLibrary: true) == [.photo, .file])
        #expect(NotationAddChoice.available(scanSupported: true, photoLibrary: true) == [.scan, .photo, .file])
        // The Mac offers neither the camera nor the photo library.
        #expect(NotationAddChoice.available(scanSupported: false, photoLibrary: false) == [.file])
    }

    // MARK: Row action

    @Test func testRowOffersNotationOnlyWithPages() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let withPages = try await makeTune(store, "Soldier's Joy")
        let without = try await makeTune(store, "Cluck Old Hen")
        let emptied = try await makeTune(store, "Kitchen Girl")
        try await commands.addNotationPages(tuneID: withPages, pages: [preparedPage], at: noon)
        let gone = try await commands.addNotationPages(tuneID: emptied, pages: [preparedPage], at: noon)
        try await commands.deleteNotationPage(gone[0], at: later(1))

        let tunes = try await store.read { db in try NotationTunes.fetch(db) }

        #expect(tunes == [withPages])
        #expect(TuneRowActions.notationAction(tuneID: withPages, tunesWithPages: tunes) { _ in } != nil)
        #expect(TuneRowActions.notationAction(tuneID: without, tunesWithPages: tunes) { _ in } == nil)
        #expect(TuneRowActions.notationAction(tuneID: emptied, tunesWithPages: tunes) { _ in } == nil)
    }

    // MARK: Viewer

    @Test func testViewerOpensAtStartIndex() {
        let ids = ["a", "b", "c"]
        #expect(NotationPager.initialPage(ids: ids, startIndex: 0) == "a")
        #expect(NotationPager.initialPage(ids: ids, startIndex: 2) == "c")
        // A page deleted between the tap and the open still lands on a page.
        #expect(NotationPager.initialPage(ids: ids, startIndex: 7) == "c")
        #expect(NotationPager.initialPage(ids: [], startIndex: 0) == nil)
        #expect(NotationPager.indicator(shown: "b", ids: ids) == "2 of 3")
        // A page that left the tune shows the nearest one's count rather than nothing.
        #expect(NotationPager.indicator(shown: "gone", ids: ids) == "1 of 3")
    }

    @Test func zoomTogglesBetweenFitAndTwice() {
        #expect(NotationZoom.toggled(1) == 2)
        #expect(NotationZoom.toggled(2) == 1)
        #expect(NotationZoom.toggled(3.4) == 1)
        #expect(NotationZoom.clamped(0.5) == 1)
        #expect(NotationZoom.clamped(9) == NotationZoom.maximum)
    }

    @Test func aPanStaysWithinTheZoomedPage() {
        // A portrait page fitted to a 400 by 400 box is 300 wide, so at 2x it overflows by 100 on
        // each side across and by 200 up and down.
        let box = CGSize(width: 400, height: 400)
        let far = CGSize(width: 900, height: -900)
        #expect(
            NotationZoom.clampedOffset(far, container: box, aspectRatio: 0.75, scale: 2)
                == CGSize(width: 100, height: -200))
        #expect(
            NotationZoom.clampedOffset(CGSize(width: 40, height: 50), container: box, aspectRatio: 0.75, scale: 2)
                == CGSize(width: 40, height: 50))
        // At 1.2x the page is still narrower than the box, so it cannot move sideways.
        #expect(
            NotationZoom.clampedOffset(far, container: box, aspectRatio: 0.75, scale: 1.2).width == 0)
        #expect(NotationZoom.clampedOffset(far, container: box, aspectRatio: 0.75, scale: 1) == .zero)
        #expect(NotationZoom.clampedOffset(far, container: .zero, aspectRatio: 0.75, scale: 2) == .zero)
    }

    @Test func aPanPastTheNewEdgeComesBackWhenTheContainerTurns() {
        // A portrait page at 2x on a portrait phone overflows by 195 across and 98 up and down;
        // turned to landscape, the page no longer overflows across at all.
        let portrait = CGSize(width: 390, height: 844)
        let landscape = CGSize(width: 844, height: 390)
        let panned = NotationZoom.clampedOffset(
            CGSize(width: 900, height: 900), container: portrait, aspectRatio: 0.75, scale: 2)
        #expect(panned == CGSize(width: 195, height: 98))
        #expect(
            NotationZoom.clampedOffset(panned, container: landscape, aspectRatio: 0.75, scale: 2)
                == CGSize(width: 0, height: 98))
    }

    // MARK: Thumbnails

    @Test func thumbnailsDecodeAt240TallAndNeverUpscale() throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let tall = root.url.appending(path: "tall.jpg")
        try jpeg(width: 600, height: 900).write(to: tall)
        let image = try #require(NotationThumbnail.decode(tall, height: NotationThumbnail.pixelHeight))
        #expect(image.height == 240)
        #expect(image.width == 160)

        let small = root.url.appending(path: "small.jpg")
        try jpeg(width: 100, height: 50).write(to: small)
        let kept = try #require(NotationThumbnail.decode(small, height: NotationThumbnail.pixelHeight))
        #expect(kept.height == 50)
        #expect(kept.width == 100)

        let broken = root.url.appending(path: "broken.jpg")
        try Data([0x00, 0x01]).write(to: broken)
        #expect(NotationThumbnail.decode(broken, height: NotationThumbnail.pixelHeight) == nil)
    }

    @MainActor
    @Test func aThumbnailStillShowsAfterTheCacheIsEmptied() async throws {
        let root = TemporaryRoot()
        try FileManager.default.createDirectory(at: root.url, withIntermediateDirectories: true)
        let url = root.url.appending(path: "page.jpg")
        try jpeg(width: 300, height: 400).write(to: url)
        let cache = ThumbnailCache(countLimit: 10)

        let first = try #require(await NotationThumbnail.load(key: "p/page.jpg", url: url, cache: cache))
        // A second load is a cache hit, and still hands back the image for the view to keep.
        try FileManager.default.removeItem(at: url)
        let hit = try #require(await NotationThumbnail.load(key: "p/page.jpg", url: url, cache: cache))
        #expect(hit === first)

        cache.removeAll()

        let decoded: (key: String, image: CGImage?) = ("p/page.jpg", hit)
        #expect(NotationThumbnail.shown(key: "p/page.jpg", decoded: decoded, cache: cache) === first)
        #expect(NotationThumbnail.shown(key: "other/page.jpg", decoded: decoded, cache: cache) == nil)
    }

    @Test func thumbnailKeyFollowsThePageAndItsFile() {
        let page = record()
        let first = NotationFile(pageID: page.id, fileName: "a.jpg", origin: .captured)
        var retried = first
        retried.uploadAttempts = 3
        let downloaded = NotationFile(pageID: page.id, fileName: "b.jpg", origin: .downloaded)
        // A file row that changes only its upload bookkeeping keeps its decoded image.
        #expect(NotationThumbnail.key(page: page, file: first) == NotationThumbnail.key(page: page, file: retried))
        #expect(NotationThumbnail.key(page: page, file: first) != NotationThumbnail.key(page: page, file: downloaded))
    }

    // MARK: Adding, moving, deleting

    @MainActor
    @Test func addsUpToTheLimitAndSaysHowManyWereLeftOut() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        try await Commands(store: store).addNotationPages(
            tuneID: tuneID, pages: Array(repeating: preparedPage, count: 18), at: noon)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.notation.pages.count == 18 }

        let picks = (0..<5).map { index in NotationPick(name: "page \(index)") { preparedPage } }
        await model.notation.add(picks)

        try await eventually { model.notation.pages.count == maxNotationPagesPerTune }
        #expect(model.notation.failure == NotationCopy.pagesNotAdded(3))
        #expect(!model.notation.isAdding)
    }

    @MainActor
    @Test func namesAnUnreadableImageAndAddsTheRest() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.shown != nil }

        await model.notation.add([
            NotationPick(name: "first.jpg") { preparedPage },
            NotationPick.data(name: "broken.heic") { Data([0x00, 0x01, 0x02]) },
            NotationPick(name: "third.jpg") { preparedPage },
        ])

        try await eventually { model.notation.pages.count == 2 }
        #expect(model.notation.failure == NotationCopy.unreadable(["broken.heic"]))
    }

    @MainActor
    @Test func aPickedFileAddsAPageNamedByItsFileName() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.shown != nil }
        let picked = root.url.appending(path: "reel.jpg")
        try jpeg(width: 300, height: 400).write(to: picked)
        let missing = root.url.appending(path: "gone.png")

        await model.notation.add([NotationPick.file(picked), NotationPick.file(missing)])

        try await eventually { model.notation.pages.count == 1 }
        let page = try #require(model.notation.pages.first)
        #expect(page.record.width == 300)
        #expect(page.record.height == 400)
        #expect(page.file?.origin == .captured)
        #expect(model.notation.failure == NotationCopy.unreadable(["gone.png"]))
    }

    @MainActor
    @Test func aMoveShowsAtOnceAndLandsInTheStore() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        let ids = try await Commands(store: store).addNotationPages(
            tuneID: tuneID, pages: [preparedPage, preparedPage, preparedPage], at: noon)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.notation.pages.count == 3 }

        model.notation.move(from: 0, to: 2)

        #expect(model.notation.pages.map(\.id) == [ids[1], ids[2], ids[0]])
        #expect(model.notation.announcement?.text == "Page 1 moved to 3 of 3")
        let expected = [ids[1], ids[2], ids[0]]
        if try await !poll({ try await store.read { db in try db.liveNotationOrder(tuneID: tuneID) } == expected }) {
            Issue.record("The move never reached the store")
        }
        // The replayed move retires once the store's read agrees, leaving the order as it was.
        try await eventually { model.notation.pages.map(\.id) == expected }
    }

    @MainActor
    @Test func aDeletedPageLeavesTheSection() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        let ids = try await Commands(store: store).addNotationPages(
            tuneID: tuneID, pages: [preparedPage, preparedPage], at: noon)
        let model = TuneModel(store: store, tuneID: tuneID)
        try await eventually { model.notation.pages.count == 2 }

        await model.notation.delete(ids[0])

        try await eventually { model.notation.pages.map(\.id) == [ids[1]] }
        #expect(model.notation.failure == nil)
    }

    @Test func deleteSaysWhetherAPageCanComeBack() {
        let pending = record(state: NotationPageRecord.pendingUpload)
        let captured = NotationPage(
            record: pending, file: NotationFile(pageID: pending.id, fileName: "a.jpg", origin: .captured))
        #expect(NotationCopy.deleteMessage(captured) == RecordingsModel.deleteUnsyncedNote)
        let ready = record()
        let downloaded = NotationPage(
            record: ready, file: NotationFile(pageID: ready.id, fileName: "a.jpg", origin: .downloaded))
        #expect(NotationCopy.deleteMessage(downloaded) == RecordingsModel.deleteSyncedNote)
    }
}

extension Database {
    fileprivate func liveNotationOrder(tuneID: String) throws -> [String] {
        NotationPageRecord.sorted(
            try NotationPageRecord.filter(Column("tune_id") == tuneID && Column("deleted_at") == nil).fetchAll(self)
        ).map(\.id)
    }
}
