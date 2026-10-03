import CrosstuneStore
import Foundation
import GRDB

private func liveLoops(recordingID: String, db: Database) throws -> [RecordingLoop] {
    try RecordingLoop.filter(RecordingLoop.CodingKeys.recordingID == recordingID).fetchAll(db)
        .filter { $0.deletedAt == nil }
}

/// The recording and its live loops, once it is known to be live with room for one more.
private func roomForLoop(recordingID: String, db: Database) throws -> (Recording, [RecordingLoop]) {
    guard let recording = try Recording.fetchOne(db, key: recordingID), recording.deletedAt == nil else {
        throw CommandError.recordingNotFound
    }
    let live = try liveLoops(recordingID: recordingID, db: db)
    guard live.count < LoopModel.maxLoops else { throw CommandError.loopLimit }
    return (recording, live)
}

/// `span` held inside the free gap at its start; `.noRoom` when it starts inside a loop or the gap is too small.
private func fitted(_ span: LoopSpan, among live: [RecordingLoop], in recording: Recording) throws -> LoopSpan {
    let loops = placed(live)
    guard let gap = LoopModel.freeGap(at: span.startMs, in: loops, bounds: loopBounds(of: recording)) else {
        throw CommandError.noRoom
    }
    return try within(span, gap)
}

private func placed(_ loops: [RecordingLoop]) -> [PlacedLoop] {
    loops.map { PlacedLoop(id: $0.id, span: LoopSpan(startMs: $0.startMs, endMs: $0.endMs), color: $0.color) }
        .sorted { $0.span.startMs < $1.span.startMs }
}

/// The recording's trimmed range on the source timeline; unbounded above while its length is unknown.
private func loopBounds(of recording: Recording) -> LoopSpan {
    LoopSpan(
        startMs: recording.trimStartMs, endMs: recording.trimEndMs ?? recording.sourceDurationMs ?? .max)
}

/// `span` held inside `room`; `.noRoom` when less than a minimum loop is left.
private func within(_ span: LoopSpan, _ room: LoopSpan) throws -> LoopSpan {
    guard let held = LoopModel.clamp(span, to: room) else { throw CommandError.noRoom }
    return held
}

private func cleanLabel(_ label: String?) -> String? {
    guard let trimmed = label?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
    return trimmed
}

extension StoreWriter {
    /// Adds a loop to a live recording, held inside the free gap at its start and colored away from
    /// its neighbors.
    @discardableResult
    public func addLoop(
        recordingID: String, startMs: Int64, endMs: Int64, label: String? = nil, at time: Timestamp = .now
    ) throws -> RecordingLoop {
        let (recording, live) = try roomForLoop(recordingID: recordingID, db: db)
        let span = try fitted(LoopSpan(startMs: startMs, endMs: endMs), among: live, in: recording)
        let color = LoopModel.pickColor(for: span, among: placed(live))
        return try put(
            RecordingLoop(
                id: newID(at: time), createdAt: time, updatedAt: time, recordingID: recordingID,
                label: cleanLabel(label), startMs: span.startMs, endMs: span.endMs, color: color),
            at: time)
    }

    /// Changes a live loop; a removed or unknown loop is left alone, since a sync tombstone can
    /// land mid-gesture. A span patch is held inside the room between the loop's neighbors. Only a
    /// patched label is cleaned; a kept one stays as stored.
    public func updateLoop(
        _ id: String, startMs: Patch<Int64> = .keep, endMs: Patch<Int64> = .keep,
        label: Patch<String?> = .keep, at time: Timestamp = .now
    ) throws {
        guard var row = try RecordingLoop.fetchOne(db, key: id), row.deletedAt == nil else { return }
        if !startMs.isKeep || !endMs.isKeep {
            guard let recording = try Recording.fetchOne(db, key: row.recordingID), recording.deletedAt == nil else {
                throw CommandError.recordingNotFound
            }
            let others = try liveLoops(recordingID: row.recordingID, db: db).filter { $0.id != id }
            let room = LoopModel.room(
                around: LoopSpan(startMs: row.startMs, endMs: row.endMs), in: placed(others),
                bounds: loopBounds(of: recording))
            let span = try within(
                LoopSpan(startMs: startMs.resolved(from: row.startMs), endMs: endMs.resolved(from: row.endMs)), room)
            row.startMs = span.startMs
            row.endMs = span.endMs
        }
        if case .value(let patched) = label { row.label = cleanLabel(patched) }
        try put(row, at: time)
    }

    public func removeLoop(_ id: String, at time: Timestamp = .now) throws {
        try tombstone(RecordingLoop.self, id: id, at: time)
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
}
