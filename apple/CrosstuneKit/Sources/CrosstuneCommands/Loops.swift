import CrosstuneStore
import Foundation
import GRDB

private func liveLoops(recordingID: String, db: Database) throws -> [RecordingLoop] {
    try RecordingLoop.filter(RecordingLoop.CodingKeys.recordingID == recordingID).fetchAll(db)
        .filter { $0.deletedAt == nil }
}

/// The recording's live loops, once it is known to be live with room for one more.
private func roomForLoop(recordingID: String, db: Database) throws -> [RecordingLoop] {
    guard let recording = try Recording.fetchOne(db, key: recordingID), recording.deletedAt == nil else {
        throw CommandError.recordingNotFound
    }
    let live = try liveLoops(recordingID: recordingID, db: db)
    guard live.count < LoopModel.maxLoops else { throw CommandError.loopLimit }
    return live
}

private func cleanLabel(_ label: String?) -> String? {
    guard let trimmed = label?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
    return trimmed
}

extension StoreWriter {
    /// Adds a loop to a live recording, colored away from the loops it overlaps.
    @discardableResult
    public func addLoop(
        recordingID: String, startMs: Int64, endMs: Int64, label: String? = nil, at time: Timestamp = .now
    ) throws -> RecordingLoop {
        let live = try roomForLoop(recordingID: recordingID, db: db)
        let color = LoopModel.pickColor(
            for: LoopSpan(startMs: startMs, endMs: endMs),
            among: live.map {
                PlacedLoop(id: $0.id, span: LoopSpan(startMs: $0.startMs, endMs: $0.endMs), color: $0.color)
            }
        )
        return try put(
            RecordingLoop(
                id: newID(at: time), createdAt: time, updatedAt: time, recordingID: recordingID,
                label: cleanLabel(label), startMs: startMs, endMs: endMs, color: color),
            at: time)
    }

    /// Changes a live loop; a removed or unknown loop is left alone, since a sync tombstone can
    /// land mid-gesture. Only a patched label is cleaned; a kept one stays as stored.
    public func updateLoop(
        _ id: String, startMs: Patch<Int64> = .keep, endMs: Patch<Int64> = .keep,
        label: Patch<String?> = .keep, at time: Timestamp = .now
    ) throws {
        guard var row = try RecordingLoop.fetchOne(db, key: id), row.deletedAt == nil else { return }
        row.startMs = startMs.resolved(from: row.startMs)
        row.endMs = endMs.resolved(from: row.endMs)
        if case .value(let patched) = label { row.label = cleanLabel(patched) }
        try put(row, at: time)
    }

    public func removeLoop(_ id: String, at time: Timestamp = .now) throws {
        try tombstone(RecordingLoop.self, id: id, at: time)
    }

    /// Undoes a removal: the stored row goes back live with its original span, if its recording is
    /// still live and has room for it.
    public func restoreLoop(_ id: String, at time: Timestamp = .now) throws {
        guard var row = try RecordingLoop.fetchOne(db, key: id), row.deletedAt != nil else { return }
        _ = try roomForLoop(recordingID: row.recordingID, db: db)
        row.deletedAt = nil
        try put(row, at: time)
    }

    /// Tombstones every loop of a recording. A recording's own delete already covers them on the
    /// server, so a cascade passes `enqueueDelete: false`.
    func tombstoneLoops(recordingID: String, at time: Timestamp, enqueueDelete: Bool = true) throws {
        for loop in try liveLoops(recordingID: recordingID, db: db) {
            try tombstone(RecordingLoop.self, id: loop.id, at: time, enqueueDelete: enqueueDelete)
        }
    }
}

extension Commands {
    @discardableResult
    public func addLoop(
        recordingID: String, startMs: Int64, endMs: Int64, label: String? = nil, at time: Timestamp = .now
    ) async throws -> RecordingLoop {
        try await store.write { writer in
            try writer.addLoop(recordingID: recordingID, startMs: startMs, endMs: endMs, label: label, at: time)
        }
    }

    public func updateLoop(
        _ id: String, startMs: Patch<Int64> = .keep, endMs: Patch<Int64> = .keep,
        label: Patch<String?> = .keep, at time: Timestamp = .now
    ) async throws {
        try await store.write { writer in
            try writer.updateLoop(id, startMs: startMs, endMs: endMs, label: label, at: time)
        }
    }

    public func removeLoop(_ id: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.removeLoop(id, at: time) }
    }

    public func restoreLoop(_ id: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.restoreLoop(id, at: time) }
    }
}
