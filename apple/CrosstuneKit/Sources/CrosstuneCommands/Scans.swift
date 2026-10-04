import CrosstuneStore
import Foundation
import GRDB

/// The most live scans one tune can hold; the API refuses more.
public let maxScansPerTune = 20

extension ScanRecord: OrderedRow {
    /// Scans in the order a tune shows them: by position, then by id when two share one, as a
    /// concurrent add on two devices can leave them.
    public static func sorted(_ scans: [ScanRecord]) -> [ScanRecord] {
        scans.sorted { ($0.position, $0.id) < ($1.position, $1.id) }
    }
}

extension StoreWriter {
    /// A tune's scans that have not been tombstoned, in scan order.
    public func liveScans(tuneID: String) throws -> [ScanRecord] {
        ScanRecord.sorted(
            try ScanRecord.filter(
                ScanRecord.CodingKeys.tuneID == tuneID && ScanRecord.CodingKeys.deletedAt == nil
            ).fetchAll(db))
    }

    /// Appends scans whose files are already in the scans folder past the tune's other scans,
    /// each waiting for upload. Refuses the whole batch when it would not fit under the limit.
    public func addScans(
        tuneID: String, scans: [(id: String, fileName: String, width: Int, height: Int)], at time: Timestamp = .now
    ) throws {
        guard let tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil else {
            throw CommandError.tuneNotFound
        }
        let live = try liveScans(tuneID: tuneID)
        guard live.count + scans.count <= maxScansPerTune else { throw CommandError.scanLimit }
        let start = nextPosition(live)
        for (offset, scan) in scans.enumerated() {
            try put(
                ScanRecord(
                    id: scan.id, createdAt: time, tuneID: tuneID, position: start + offset, width: scan.width,
                    height: scan.height),
                at: time)
            try ScanFile(scanID: scan.id, fileName: scan.fileName, origin: .captured).insert(db)
        }
    }

    /// Moves a scan just past another of the same tune's scans and renumbers them from 0; see
    /// ``moveBeside(_:id:itemID:targetID:)``.
    public func moveScan(_ scanID: String, targetID: String, at time: Timestamp = .now) throws {
        guard let scan = try ScanRecord.fetchOne(db, key: scanID), scan.deletedAt == nil else { return }
        try writeOrder(
            moveBeside(try liveScans(tuneID: scan.tuneID), id: \.id, itemID: scanID, targetID: targetID),
            at: time)
    }

    /// Tombstones a scan and lets go of its file, captured or downloaded.
    public func deleteScan(_ scanID: String, at time: Timestamp = .now) throws {
        try tombstone(ScanRecord.self, id: scanID, at: time)
        try ScanFile.deleteOne(db, key: scanID)
    }

    /// Tombstones every scan of a tune and lets go of their files, a captured scan's included,
    /// as the tune it belonged to is gone. Called from a tune's own delete, whose push covers
    /// the scans.
    func tombstoneTuneScans(tuneID: String, at time: Timestamp) throws {
        let scans = try ScanRecord.filter(ScanRecord.CodingKeys.tuneID == tuneID).fetchAll(db)
        for scan in scans {
            try tombstone(ScanRecord.self, id: scan.id, at: time, enqueueDelete: false)
            try ScanFile.deleteOne(db, key: scan.id)
        }
    }
}

extension Commands {
    /// Adds prepared scans to the end of a tune and returns their ids, in order. Each image is
    /// written to the scans folder before the rows that name it, so a row never points at a
    /// missing file; a write that fails removes the images again.
    @discardableResult
    public func addScans(tuneID: String, scans: [PreparedScan], at time: Timestamp = .now) async throws
        -> [String]
    {
        let folder = store.scansFolder
        var written: [(id: String, fileName: String, width: Int, height: Int)] = []
        do {
            for scan in scans {
                let id = newID(at: time)
                // The suffix keeps a captured file's name apart from any name derived from the
                // scan id alone, such as a download's.
                let fileName = "\(id)-\(UUID().uuidString).jpg"
                try scan.jpeg.write(to: folder.appending(path: fileName), options: .atomic)
                written.append((id, fileName, scan.width, scan.height))
                try store.applyBackupRule(toScanFile: fileName, origin: .captured)
            }
            let rows = written
            try await store.write { writer in try writer.addScans(tuneID: tuneID, scans: rows, at: time) }
        } catch {
            for file in written {
                try? FileManager.default.removeItem(at: folder.appending(path: file.fileName))
            }
            throw error
        }
        return written.map(\.id)
    }

    public func moveScan(_ scanID: String, targetID: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.moveScan(scanID, targetID: targetID, at: time) }
    }

    /// Deletes a scan and its image on this device.
    public func deleteScan(_ scanID: String, at time: Timestamp = .now) async throws {
        try await store.writeDroppingFiles { writer in try writer.deleteScan(scanID, at: time) }
    }
}
