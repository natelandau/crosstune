import CoreGraphics
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import ImageIO
import Testing

@testable import CrosstuneCommands

private func size(of data: Data) throws -> (width: Int, height: Int) {
    let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
    let properties = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
    let width = try #require(properties[kCGImagePropertyPixelWidth] as? Int)
    let height = try #require(properties[kCGImagePropertyPixelHeight] as? Int)
    return (width, height)
}

private func isNearly(_ color: ScanFixtures.RGBA, _ expected: ScanFixtures.RGBA) -> Bool {
    abs(Int(color.red) - Int(expected.red)) < 40 && abs(Int(color.green) - Int(expected.green)) < 40
        && abs(Int(color.blue) - Int(expected.blue)) < 40
}

private let white = ScanFixtures.RGBA(red: 255, green: 255, blue: 255, alpha: 255)
private let black = ScanFixtures.RGBA(red: 0, green: 0, blue: 0, alpha: 255)

/// A scan small enough to write many of, with distinct bytes so files can be told apart.
private func scan(_ tag: UInt8, width: Int = 1700, height: Int = 2200) -> PreparedScan {
    PreparedScan(jpeg: Data([0xFF, 0xD8, tag]), width: width, height: height)
}

/// The marker byte of each segment before start of scan, in order.
private func segmentMarkers(_ jpeg: Data) -> [UInt8] {
    let bytes = [UInt8](jpeg)
    var markers: [UInt8] = []
    var at = 2
    while at + 4 <= bytes.count, bytes[at] == 0xFF, bytes[at + 1] != 0xDA {
        markers.append(bytes[at + 1])
        at += 2 + (Int(bytes[at + 2]) << 8 | Int(bytes[at + 3]))
    }
    return markers
}

/// One marker segment: its marker, its length, and `payload`.
private func segment(_ marker: UInt8, _ payload: [UInt8]) -> [UInt8] {
    let length = payload.count + 2
    return [0xFF, marker, UInt8(length >> 8), UInt8(length & 0xFF)] + payload
}

private func makeTune(_ store: CrosstuneStore) async throws -> String {
    try await Commands(store: store).createTune(
        TuneInput(title: "Soldier's Joy"), userTune: UserTuneInput(status: "known"), at: noon
    ).tuneID
}

private func liveScans(_ store: CrosstuneStore, tuneID: String) async throws -> [ScanRecord] {
    ScanRecord.sorted(
        try await store.read { db in
            try ScanRecord.filter(Column("tune_id") == tuneID && Column("deleted_at") == nil).fetchAll(db)
        })
}

private func scanFolderFiles(_ store: CrosstuneStore) throws -> Set<String> {
    Set(try FileManager.default.contentsOfDirectory(atPath: store.scansFolder.path(percentEncoded: false)))
}

@Suite struct ScanTests {
    // MARK: Preparing an image

    @Test func scalesLongEdgeTo2400() throws {
        let prepared = try PreparedScan.make(from: ScanFixtures.large)

        #expect(prepared.width == 2400)
        #expect(prepared.height == 1600)
        #expect(try size(of: prepared.jpeg) == (2400, 1600))
    }

    @Test func scalesAScannedImageToTheSameCap() throws {
        let scan = ScanFixtures.flat(width: 3000, height: 6000, white)

        let prepared = try PreparedScan.make(from: scan)

        #expect((prepared.width, prepared.height) == (1200, 2400))
        #expect(try size(of: prepared.jpeg) == (1200, 2400))
    }

    @Test func leavesASmallImageAtItsOwnSize() throws {
        let prepared = try PreparedScan.make(from: ScanFixtures.transparent)

        #expect((prepared.width, prepared.height) == (64, 64))
    }

    @Test func appliesOrientation() throws {
        let prepared = try PreparedScan.make(from: ScanFixtures.rotatedEXIF)

        #expect((prepared.width, prepared.height) == (40, 60))
        #expect(try size(of: prepared.jpeg) == (40, 60))
        #expect(isNearly(ScanFixtures.pixel(of: prepared.jpeg, x: 20, y: 5), ScanFixtures.red))
        #expect(isNearly(ScanFixtures.pixel(of: prepared.jpeg, x: 20, y: 55), ScanFixtures.blue))
    }

    @Test func stripsMetadata() throws {
        let original = try #require(CGImageSourceCreateWithData(ScanFixtures.withMetadata as CFData, nil))
        let before = try #require(CGImageSourceCopyPropertiesAtIndex(original, 0, nil) as? [CFString: Any])
        #expect(before[kCGImagePropertyGPSDictionary] != nil, "the fixture carries a location to strip")

        let prepared = try PreparedScan.make(from: ScanFixtures.withMetadata)

        let source = try #require(CGImageSourceCreateWithData(prepared.jpeg as CFData, nil))
        let properties = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        #expect(properties[kCGImagePropertyExifDictionary] == nil)
        #expect(properties[kCGImagePropertyIPTCDictionary] == nil)
        #expect(properties[kCGImagePropertyGPSDictionary] == nil)
        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        #expect(orientation == 1)
        let tiff = properties[kCGImagePropertyTIFFDictionary] as? [CFString: Any] ?? [:]
        #expect(tiff[kCGImagePropertyTIFFMake] == nil)
        #expect(tiff[kCGImagePropertyTIFFModel] == nil)
        #expect(tiff[kCGImagePropertyTIFFOrientation] as? Int ?? 1 == 1)
        #expect((prepared.width, prepared.height) == (40, 60), "the rotation is kept in the pixels")
    }

    @Test func dropsOnlyTheExifAndPhotoshopSegments() throws {
        let encoded = [UInt8](ScanFixtures.encode(ScanFixtures.flat(width: 8, height: 8, white), as: .jpeg))
        // The encoder's own segments, minus any APP0, follow the ones added here.
        var rest: [UInt8] = []
        var at = 2
        while encoded[at + 1] != 0xDA {
            let end = at + 2 + (Int(encoded[at + 2]) << 8 | Int(encoded[at + 3]))
            if encoded[at + 1] != 0xE0 { rest += encoded[at..<end] }
            at = end
        }
        rest += encoded[at...]
        let jfif: [UInt8] = Array("JFIF".utf8) + [0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
        let synthetic = Data(
            [0xFF, 0xD8] + segment(0xE0, jfif) + segment(0xE1, Array("Exif".utf8) + [0, 0, 1, 2, 3])
                + segment(0xE2, Array("CROSSTUNE".utf8) + [0, 4, 5]) + segment(0xED, Array("Photoshop 3.0".utf8) + [0])
                + rest)
        #expect(Set(segmentMarkers(synthetic)).isSuperset(of: [0xE0, 0xE1, 0xE2, 0xED, 0xDB, 0xC0]))

        let stripped = PreparedScan.withoutMetadataSegments(synthetic)

        let markers = segmentMarkers(stripped)
        #expect(Set(markers).isSuperset(of: [0xE0, 0xE2, 0xDB, 0xC0]))
        #expect(!markers.contains(0xE1))
        #expect(!markers.contains(0xED))
        #expect(markers.first == 0xE0)
        #expect(try size(of: stripped) == (8, 8))
        let source = try #require(CGImageSourceCreateWithData(stripped as CFData, nil))
        #expect(CGImageSourceCreateImageAtIndex(source, 0, nil) != nil)
    }

    @Test func flattensTransparencyToWhite() throws {
        let prepared = try PreparedScan.make(from: ScanFixtures.transparent)

        #expect(isNearly(ScanFixtures.pixel(of: prepared.jpeg, x: 40, y: 40), white))
        #expect(isNearly(ScanFixtures.pixel(of: prepared.jpeg, x: 4, y: 4), black))
    }

    @Test func refusesUndecodable() {
        #expect(throws: PreparedScan.Error.undecodable) { try PreparedScan.make(from: ScanFixtures.notAnImage) }
        #expect(throws: PreparedScan.Error.undecodable) { try PreparedScan.make(from: Data()) }
    }

    // MARK: Scan commands

    @Test func addAppendsInOrder() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let tuneID = try await makeTune(store)
        let first = try await commands.addScans(tuneID: tuneID, scans: [scan(1)], at: noon)

        let ids = try await commands.addScans(
            tuneID: tuneID, scans: [scan(2, width: 800, height: 600), scan(3)], at: later(1000))

        let scans = try await liveScans(store, tuneID: tuneID)
        #expect(scans.map(\.id) == first + ids)
        #expect(scans.map(\.position) == [0, 1, 2])
        #expect((scans[1].width, scans[1].height) == (800, 600))
        #expect(scans.allSatisfy { $0.state == ScanRecord.pendingUpload })
        let files = try await store.read { db in try ScanFile.fetchAll(db) }
        #expect(files.allSatisfy { $0.origin == .captured })
        for (scanID, tag) in zip(first + ids, [UInt8(1), 2, 3]) {
            let file = try #require(files.first { $0.scanID == scanID })
            let written = try Data(contentsOf: store.scansFolder.appending(path: file.fileName))
            #expect(written == Data([0xFF, 0xD8, tag]))
        }
        let queued = try await store.pendingChanges(limit: 10).filter { $0.tableName == .scans }
        #expect(queued.map(\.rowID) == first + ids)
        #expect(queued.allSatisfy { $0.op == .upsert })
    }

    @Test func namesEachWrittenFileUniquely() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let tuneID = try await makeTune(store)

        _ = try await commands.addScans(tuneID: tuneID, scans: [scan(1), scan(2), scan(3)], at: noon)

        let names = try await store.read { db in try String.fetchAll(db, sql: "SELECT file_name FROM scan_files") }
        #expect(Set(names).count == 3)
        #expect(try scanFolderFiles(store) == Set(names))
    }

    @Test func refusesTwentyFirstScan() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let tuneID = try await makeTune(store)
        let nineteen = try await commands.addScans(
            tuneID: tuneID, scans: (0..<19).map { scan(UInt8($0)) }, at: noon)
        try await commands.deleteScan(nineteen[0], at: later(1000))
        _ = try await commands.addScans(tuneID: tuneID, scans: [scan(20), scan(21)], at: later(2000))
        let filesBefore = try scanFolderFiles(store)

        await #expect(throws: CommandError.scanLimit) {
            try await commands.addScans(tuneID: tuneID, scans: [scan(22)], at: later(3000))
        }

        #expect(try await liveScans(store, tuneID: tuneID).count == maxScansPerTune)
        #expect(try scanFolderFiles(store) == filesBefore, "a refused add leaves no file behind")
        #expect(CommandError.scanLimit.errorDescription == "A tune holds at most 20 scans.")
    }

    @Test func refusesAScanForAMissingTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()

        await #expect(throws: CommandError.tuneNotFound) {
            try await Commands(store: store).addScans(tuneID: "missing", scans: [scan(1)], at: noon)
        }

        #expect(try scanFolderFiles(store).isEmpty)
    }

    @Test func moveRenumbers() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let tuneID = try await makeTune(store)
        let ids = try await commands.addScans(tuneID: tuneID, scans: [scan(1), scan(2), scan(3)], at: noon)
        let otherTune = try await makeTune(store)
        let other = try await commands.addScans(tuneID: otherTune, scans: [scan(4)], at: noon)

        try await commands.moveScan(ids[0], targetID: ids[2], at: later(1000))
        #expect(try await liveScans(store, tuneID: tuneID).map(\.id) == [ids[1], ids[2], ids[0]])
        #expect(try await liveScans(store, tuneID: tuneID).map(\.position) == [0, 1, 2])

        try await commands.moveScan(ids[0], targetID: ids[1], at: later(2000))
        #expect(try await liveScans(store, tuneID: tuneID).map(\.id) == [ids[0], ids[1], ids[2]])
        #expect(try await liveScans(store, tuneID: otherTune).map(\.position) == [0])

        try await commands.moveScan(ids[0], targetID: other[0], at: later(3000))
        #expect(
            try await liveScans(store, tuneID: tuneID).map(\.id) == ids, "a target on another tune moves nothing")
    }

    @Test func scansSortByPositionThenID() {
        let scans = [
            ScanRecord(id: "c", tuneID: "t", position: 1, width: 1, height: 1),
            ScanRecord(id: "b", tuneID: "t", position: 0, width: 1, height: 1),
            ScanRecord(id: "a", tuneID: "t", position: 1, width: 1, height: 1),
        ]

        #expect(ScanRecord.sorted(scans).map(\.id) == ["b", "a", "c"])
    }

    @Test func deleteTombstonesTheScanAndDropsItsFile() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let tuneID = try await makeTune(store)
        let ids = try await commands.addScans(tuneID: tuneID, scans: [scan(1), scan(2)], at: noon)

        try await commands.deleteScan(ids[0], at: later(1000))

        let row = try #require(try await store.read { db in try ScanRecord.fetchOne(db, key: ids[0]) })
        #expect(row.deletedAt != nil)
        #expect(try await store.read { db in try ScanFile.fetchOne(db, key: ids[0]) } == nil)
        let kept = try #require(try await store.read { db in try ScanFile.fetchOne(db, key: ids[1]) })
        #expect(try scanFolderFiles(store) == [kept.fileName])
        let queued = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == ids[0] })
        #expect(queued.op == .delete)
    }

    @Test func deletingATuneTombstonesItsScansAndDropsTheirFiles() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let tuneID = try await makeTune(store)
        let ids = try await commands.addScans(tuneID: tuneID, scans: [scan(1), scan(2)], at: noon)
        let otherTune = try await makeTune(store)
        let other = try await commands.addScans(tuneID: otherTune, scans: [scan(3)], at: noon)
        let deleteTime = later(60 * 60 * 1000)

        try await commands.deleteTune(tuneID, at: deleteTime)

        for id in ids {
            #expect(
                try await store.read { db in try ScanRecord.fetchOne(db, key: id) }?.deletedAt == deleteTime)
        }
        let files = try await store.read { db in try ScanFile.fetchAll(db) }
        #expect(files.map(\.scanID) == other, "a captured scan goes with its tune")
        #expect(try scanFolderFiles(store) == Set(files.map(\.fileName)))
        let queued = try await store.pendingChanges(limit: 20)
        #expect(
            !queued.contains { $0.tableName == .scans && ids.contains($0.rowID) },
            "the tune's delete covers them")
    }

    @Test func addKeepsACapturedFileInBackups() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let tuneID = try await makeTune(store)
        let ids = try await Commands(store: store).addScans(tuneID: tuneID, scans: [scan(1)], at: noon)

        let file = try #require(try await store.read { db in try ScanFile.fetchOne(db, key: ids[0]) })
        // A URL caches resource values it has read, which would hide a later change.
        var url = store.scansFolder.appending(path: file.fileName)
        url.removeAllCachedResourceValues()
        #expect(try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == false)
    }

    @Test func deletingTunesTogetherDropsTheirScanFiles() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let a = try await commands.createTune(TuneInput(title: "A"), userTune: UserTuneInput(status: "known"), at: noon)
        let b = try await commands.createTune(TuneInput(title: "B"), userTune: UserTuneInput(status: "known"), at: noon)
        let ids = try await commands.addScans(tuneID: a.tuneID, scans: [scan(1), scan(2)], at: noon)
        let kept = try await commands.addScans(tuneID: b.tuneID, scans: [scan(3)], at: noon)

        try await commands.deleteTunes([a.userTuneID], at: later(1000))

        for id in ids {
            #expect(try await store.read { db in try ScanRecord.fetchOne(db, key: id) }?.deletedAt != nil)
        }
        let files = try await store.read { db in try ScanFile.fetchAll(db) }
        #expect(files.map(\.scanID) == kept)
        #expect(try scanFolderFiles(store) == Set(files.map(\.fileName)))
    }
}
