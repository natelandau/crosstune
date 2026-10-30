import CrosstuneStore
import Foundation
import GRDB

/// A refusal the Split screen prevents, so it carries a code and no user-facing copy.
public enum SplitError: Error, Equatable, Sendable {
    case openSplit
    case cutOutside
    case pieceTooShort
    case pieceTooLong
    case tooManyPieces
}

extension StoreWriter {
    /// Splits a recording at `cutsMs`, positions on its source timeline. The parent keeps the first
    /// piece and every later piece becomes a new unfiled row; returns the new piece ids in order.
    /// Loops wholly inside a later piece move onto it, and loops crossing a cut are removed.
    @discardableResult
    public func splitRecording(_ parentID: String, cutsMs: [Int64], at time: Timestamp = .now) throws -> [String] {
        guard let parent = try Recording.fetchOne(db, key: parentID), parent.deletedAt == nil else {
            throw CommandError.recordingNotFound
        }
        guard !RecordingLimits.splitIncomplete(parent) else { throw SplitError.openSplit }

        let start = parent.trimStartMs
        let file = try RecordingFile.fetchOne(db, key: parentID)
        guard let end = RecordingLimits.splitRangeEnd(parent, file: file) else { throw SplitError.cutOutside }
        let cuts = cutsMs.sorted()
        guard !cuts.isEmpty, cuts.allSatisfy({ $0 > start && $0 < end }) else { throw SplitError.cutOutside }
        let bounds = [start] + cuts + [end]
        switch RecordingLimits.pieceProblem(edges: bounds) {
        case .tooMany: throw SplitError.tooManyPieces
        case .tooShort: throw SplitError.pieceTooShort
        case .tooLong: throw SplitError.pieceTooLong
        case nil: break
        }

        let splitID = newID(at: time)
        let size = cuts.count + 1
        var narrowed = parent
        narrowed.splitID = splitID
        narrowed.splitSize = size
        narrowed.trimEndMs = cuts[0]
        try put(narrowed, at: time)

        var position = nextPosition(
            activeByPosition(try Recording.filter(Recording.CodingKeys.tuneID == nil).fetchAll(db)))
        var ids: [String] = []
        for index in 1..<size {
            let id = newID(at: time)
            ids.append(id)
            try put(
                Self.piece(
                    of: parent, id: id, splitID: splitID, number: index + 1, trimStartMs: bounds[index],
                    trimEndMs: bounds[index + 1], position: position, at: time),
                at: time)
            position += 1
        }

        let loops = try RecordingLoop.filter(RecordingLoop.CodingKeys.recordingID == parentID).fetchAll(db)
            .filter { $0.deletedAt == nil }
        for loop in loops {
            let index = (0..<size).first { loop.startMs >= bounds[$0] && loop.endMs <= bounds[$0 + 1] }
            if index == 0 { continue }
            try tombstone(RecordingLoop.self, id: loop.id, at: time)
            guard let index else { continue }
            var copy = loop
            copy.id = newID(at: time)
            copy.recordingID = ids[index - 1]
            copy.createdAt = time
            copy.serverSeq = 0
            try put(copy, at: time)
        }
        return ids
    }

    private static func piece(
        of parent: Recording, id: String, splitID: String, number: Int, trimStartMs: Int64, trimEndMs: Int64,
        position: Int, at time: Timestamp
    ) -> Recording {
        Recording(
            id: id, createdAt: time, tuneID: nil, source: parent.source, origin: parent.origin,
            originURL: parent.originURL, addedAt: parent.addedAt, recordedAt: parent.recordedAt,
            recordedPrecision: parent.recordedPrecision,
            label: RecordingLimits.pieceLabel(parent.label, number: number), position: position,
            state: "processing", trimStartMs: trimStartMs, trimEndMs: trimEndMs,
            speedPercent: parent.speedPercent, pitchCents: parent.pitchCents, notes: parent.notes,
            players: parent.players, placeName: parent.placeName, placeLat: parent.placeLat,
            placeLon: parent.placeLon, placeAccuracyM: parent.placeAccuracyM, placeID: parent.placeID,
            placeOrigin: parent.placeOrigin, splitFromID: parent.id, createdBySplitID: splitID)
    }
}

extension Commands {
    @discardableResult
    public func splitRecording(_ parentID: String, cutsMs: [Int64], at time: Timestamp = .now) async throws -> [String]
    {
        try await store.write { writer in try writer.splitRecording(parentID, cutsMs: cutsMs, at: time) }
    }
}
