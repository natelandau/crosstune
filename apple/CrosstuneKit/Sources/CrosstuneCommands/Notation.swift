import CrosstuneStore
import Foundation
import GRDB

/// The most live pages one tune can hold; the API refuses more.
public let maxNotationPagesPerTune = 20

extension NotationPageRecord: OrderedRow {
    /// Pages in the order a tune shows them: by position, then by id when two share one, as a
    /// concurrent add on two devices can leave them.
    public static func sorted(_ pages: [NotationPageRecord]) -> [NotationPageRecord] {
        pages.sorted { ($0.position, $0.id) < ($1.position, $1.id) }
    }
}

extension StoreWriter {
    /// A tune's pages that have not been tombstoned, in page order.
    public func liveNotationPages(tuneID: String) throws -> [NotationPageRecord] {
        NotationPageRecord.sorted(
            try NotationPageRecord.filter(
                NotationPageRecord.CodingKeys.tuneID == tuneID && NotationPageRecord.CodingKeys.deletedAt == nil
            ).fetchAll(db))
    }

    /// Appends pages whose files are already in the notation folder past the tune's other pages,
    /// each waiting for upload. Refuses the whole batch when it would not fit under the limit.
    public func addNotationPages(
        tuneID: String, pages: [(id: String, fileName: String, width: Int, height: Int)], at time: Timestamp = .now
    ) throws {
        guard let tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil else {
            throw CommandError.tuneNotFound
        }
        let live = try liveNotationPages(tuneID: tuneID)
        guard live.count + pages.count <= maxNotationPagesPerTune else { throw CommandError.notationPageLimit }
        let start = nextPosition(live)
        for (offset, page) in pages.enumerated() {
            try put(
                NotationPageRecord(
                    id: page.id, createdAt: time, tuneID: tuneID, position: start + offset, width: page.width,
                    height: page.height),
                at: time)
            try NotationFile(pageID: page.id, fileName: page.fileName, origin: .captured).insert(db)
        }
    }

    /// Moves a page just past another of the same tune's pages and renumbers them from 0; see
    /// ``moveBeside(_:id:itemID:targetID:)``.
    public func moveNotationPage(_ pageID: String, targetID: String, at time: Timestamp = .now) throws {
        guard let page = try NotationPageRecord.fetchOne(db, key: pageID), page.deletedAt == nil else { return }
        try writeOrder(
            moveBeside(try liveNotationPages(tuneID: page.tuneID), id: \.id, itemID: pageID, targetID: targetID),
            at: time)
    }

    /// Tombstones a page and lets go of its file, captured or downloaded.
    public func deleteNotationPage(_ pageID: String, at time: Timestamp = .now) throws {
        try tombstone(NotationPageRecord.self, id: pageID, at: time)
        try NotationFile.deleteOne(db, key: pageID)
    }

    /// Tombstones every page of a tune and lets go of their files, a captured page's included,
    /// as the tune it belonged to is gone. Called from a tune's own delete, whose push covers
    /// the pages.
    func tombstoneTuneNotationPages(tuneID: String, at time: Timestamp) throws {
        let pages = try NotationPageRecord.filter(NotationPageRecord.CodingKeys.tuneID == tuneID).fetchAll(db)
        for page in pages {
            try tombstone(NotationPageRecord.self, id: page.id, at: time, enqueueDelete: false)
            try NotationFile.deleteOne(db, key: page.id)
        }
    }
}

extension Commands {
    /// Adds prepared pages to the end of a tune and returns their ids, in order. Each image is
    /// written to the notation folder before the rows that name it, so a row never points at a
    /// missing file; a write that fails removes the images again.
    @discardableResult
    public func addNotationPages(tuneID: String, pages: [PreparedPage], at time: Timestamp = .now) async throws
        -> [String]
    {
        let folder = store.notationFolder
        var written: [(id: String, fileName: String, width: Int, height: Int)] = []
        do {
            for page in pages {
                let id = newID(at: time)
                // The suffix keeps a captured file's name apart from any name derived from the
                // page id alone, such as a download's.
                let fileName = "\(id)-\(UUID().uuidString).jpg"
                try page.jpeg.write(to: folder.appending(path: fileName), options: .atomic)
                written.append((id, fileName, page.width, page.height))
                try store.applyBackupRule(toNotationFile: fileName, origin: .captured)
            }
            let rows = written
            try await store.write { writer in try writer.addNotationPages(tuneID: tuneID, pages: rows, at: time) }
        } catch {
            for file in written {
                try? FileManager.default.removeItem(at: folder.appending(path: file.fileName))
            }
            throw error
        }
        return written.map(\.id)
    }

    public func moveNotationPage(_ pageID: String, targetID: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.moveNotationPage(pageID, targetID: targetID, at: time) }
    }

    /// Deletes a page and its image on this device.
    public func deleteNotationPage(_ pageID: String, at time: Timestamp = .now) async throws {
        try await store.writeDroppingFiles { writer in try writer.deleteNotationPage(pageID, at: time) }
    }
}
