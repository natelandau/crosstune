import CoreGraphics
import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import Observation
import os

/// A scan with this device's file for it, if any.
public struct Scan: Hashable, Sendable, Identifiable {
    public let record: ScanRecord
    public let file: ScanFile?

    public init(record: ScanRecord, file: ScanFile?) {
        self.record = record
        self.file = file
    }

    public var id: String { record.id }

    /// Width over height, from the stored size, so a scan lays out before its file arrives.
    public var aspectRatio: CGFloat {
        record.width > 0 && record.height > 0 ? CGFloat(record.width) / CGFloat(record.height) : 0.77
    }

    /// A tune's live scans in scan order, each with its file.
    nonisolated static func fetch(_ db: Database, tuneID: String) throws -> [Scan] {
        let records = ScanRecord.sorted(
            try ScanRecord.filter(
                ScanRecord.CodingKeys.tuneID == tuneID && ScanRecord.CodingKeys.deletedAt == nil
            ).fetchAll(db))
        let files = try ScanFile.fetchAll(db, keys: records.map(\.id))
        let fileByID = Dictionary(files.map { ($0.scanID, $0) }, uniquingKeysWith: { first, _ in first })
        return records.map { Scan(record: $0, file: fileByID[$0.id]) }
    }
}

/// What the Scans section shows for a number of scans.
public struct ScansSectionLayout: Equatable, Sendable {
    public let scanCount: Int

    public init(scanCount: Int) {
        self.scanCount = scanCount
    }

    public var showsEmptyState: Bool { scanCount == 0 }
    /// Edit reorders and deletes, so it waits for a scan to act on.
    public var showsEdit: Bool { scanCount > 0 }
    public var canAdd: Bool { scanCount < maxScansPerTune }
    public var limitNote: String? { canAdd ? nil : ScanCopy.limitNote }
}

/// One picked image, named for the message that says it could not be read, and prepared when
/// its turn comes.
public struct ScanPick: Sendable {
    public let name: String
    let prepare: @Sendable () async throws -> PreparedScan

    public init(name: String, prepare: @escaping @Sendable () async throws -> PreparedScan) {
        self.name = name
        self.prepare = prepare
    }

    /// A photo or file whose bytes `load` reads.
    public static func data(name: String, load: @escaping @Sendable () async throws -> Data) -> ScanPick {
        ScanPick(name: name) { try PreparedScan.make(from: try await load()) }
    }

    /// A file the file picker returned, read under its security scope.
    public static func file(_ url: URL) -> ScanPick {
        data(name: url.lastPathComponent) {
            // A picked file is outside the app's sandbox until access is asked for.
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return try Data(contentsOf: url)
        }
    }
}

/// A tune's scans and the writes the Scans section makes, reorders shown at once.
/// Reads the scans on its own, so an upload's bookkeeping redraws only the section, not the
/// whole tune screen.
@MainActor
@Observable
public final class ScansModel {
    /// Why the last add, move, or delete failed, or what a pick left out, until the next one.
    public private(set) var failure: String?
    /// The last move, for the screen to read out and to feel.
    public private(set) var announcement: ListModel.Announcement?
    /// True while picked images are being prepared and stored.
    public private(set) var isAdding = false

    private let store: CrosstuneStore
    private let tuneID: String
    private let query: LiveQuery<[Scan]?>
    private var moves = PendingMoves()
    /// Counts each read of the scans, so a settled move can tell whether a read has landed since.
    private var revision = 0
    @ObservationIgnored private var lastWrite: Task<Void, Never>?
    @ObservationIgnored private var following: Task<Void, Never>?
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "scans")

    init(store: CrosstuneStore, tuneID: String) {
        self.store = store
        self.tuneID = tuneID
        let query = LiveQuery<[Scan]?>(store, initial: nil) { db in
            try Scan.fetch(db, tuneID: tuneID)
        }
        self.query = query
        following = Task { [weak self] in
            for await value in Observations({ @MainActor in query.value }) {
                guard let self, let value else { continue }
                revision += 1
                moves.retire(order: value.map(\.id), revision: revision)
            }
        }
    }

    isolated deinit {
        following?.cancel()
    }

    private var read: [Scan] { query.value ?? [] }

    /// The tune's scans in stored order with the moves in flight replayed.
    public var scans: [Scan] {
        let byID = Dictionary(read.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return moves.apply(to: read.map(\.id)).compactMap { byID[$0] }
    }

    public var layout: ScansSectionLayout { ScansSectionLayout(scanCount: scans.count) }

    /// Prepares and stores picked images one at a time, in the order picked, so each scan shows
    /// as soon as it is ready and a pick past the limit stops where the tune is full. An image
    /// that cannot be read is named and the rest still add.
    public func add(_ picks: [ScanPick]) async {
        guard !picks.isEmpty else { return }
        isAdding = true
        failure = nil
        var room = maxScansPerTune - scans.count
        var skipped = 0
        var unreadable: [String] = []
        var stopped: String?
        let commands = Commands(store: store)
        for pick in picks {
            guard room > 0 else {
                skipped += 1
                continue
            }
            let prepared: PreparedScan
            do {
                // Decoding and encoding a full image is slow, so it runs off the main actor.
                prepared = try await Task.detached(priority: .userInitiated) { try await pick.prepare() }.value
            } catch {
                // A photo that would not load reads to the musician the same as one that would
                // not decode: that image, by name, did not add.
                Self.logger.info("A picked scan image could not be read: \(error)")
                unreadable.append(pick.name)
                continue
            }
            do {
                try await commands.addScans(tuneID: tuneID, scans: [prepared])
                room -= 1
            } catch CommandError.scanLimit {
                // Another device filled the tune while this pick was running.
                skipped += 1
                room = 0
            } catch {
                Self.logger.warning("Adding a scan failed: \(error)")
                stopped = Self.message(error)
                break
            }
        }
        let said = [
            unreadable.isEmpty ? nil : ScanCopy.unreadable(unreadable),
            skipped > 0 ? ScanCopy.scansNotAdded(skipped) : nil,
            stopped,
        ].compactMap { $0 }
        failure = said.isEmpty ? nil : said.joined(separator: " ")
        isAdding = false
    }

    /// Shows why a picker could not hand over its images.
    func report(_ error: any Error) {
        Self.logger.warning("A scan picker failed: \(error)")
        failure = Self.message(error)
    }

    /// Deletes a scan and its image on this device.
    public func delete(_ scanID: String) async {
        failure = nil
        do {
            try await Commands(store: store).deleteScan(scanID)
        } catch {
            Self.logger.warning("Deleting a scan failed: \(error)")
            failure = Self.message(error)
        }
    }

    /// The moves that go somewhere from this scan among the scans on screen.
    func places(for scan: Scan) -> [MovePlace] {
        let scans = scans
        guard let index = scans.firstIndex(where: { $0.id == scan.id }) else { return [] }
        return MovePlace.places(at: index, count: scans.count)
    }

    /// Sends a scan where the menu says, among the scans on screen when it is chosen.
    func move(_ scan: Scan, to place: MovePlace) {
        let scans = scans
        guard let index = scans.firstIndex(where: { $0.id == scan.id }) else { return }
        move(from: index, to: place.destination(from: index, count: scans.count))
    }

    /// Moves the scan at `from` to where the scan at `to` stands, among the scans on screen.
    public func move(from: Int, to: Int) {
        let scans = scans
        guard let move = ListMove(ids: scans.map(\.id), from: from, to: to) else { return }
        let spoken = ListModel.Announcement(
            id: (announcement?.id ?? 0) + 1, text: ScanCopy.moved(from: from, to: to, total: scans.count))
        announcement = spoken
        failure = nil
        let handle = moves.begin(move)
        let previous = lastWrite
        let tuneID = tuneID
        let store = store
        // Chained, so the store applies the moves in the order they were made, which is the
        // order they replay in.
        lastWrite = Task {
            await previous?.value
            do {
                try await Commands(store: store).moveScan(move.itemID, targetID: move.targetID)
            } catch {
                Self.logger.warning("A scan move failed: \(error)")
                moves.drop(handle)
                if announcement == spoken { announcement = nil }
                failure = Self.message(error)
                return
            }
            let shownRevision = revision
            guard
                let stored = try? await store.read({ db in try Scan.fetch(db, tuneID: tuneID).map(\.id) })
            else {
                moves.drop(handle)
                return
            }
            moves.settle(handle, revision: shownRevision, storedOrder: stored)
            moves.retire(order: read.map(\.id), revision: revision)
        }
    }

    private static func message(_ error: any Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? CatalogModel.actionFailed
    }
}

/// The tunes that hold at least one live scan, which decides whether a tune row offers its
/// Scans action. One query for every row on every screen.
@MainActor
@Observable
public final class ScanTunes {
    private let query: LiveQuery<Set<String>>

    public init(store: CrosstuneStore) {
        query = LiveQuery(store, initial: []) { db in try Self.fetch(db) }
    }

    public var ids: Set<String> { query.value }

    nonisolated static func fetch(_ db: Database) throws -> Set<String> {
        Set(
            try String.fetchAll(
                db, sql: "SELECT DISTINCT tune_id FROM scans WHERE deleted_at IS NULL"))
    }
}
