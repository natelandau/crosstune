import Foundation
import GRDB

/// The length and split limits shared with the web client and the server.
public enum RecordingLimits {
    /// The longest recording the server accepts for upload.
    public static let maxRecordingMs: Int64 = 10_800_000
    /// The longest source the server accepts even as a split parent.
    public static let maxSplitSourceMs: Int64 = 43_200_000
    /// The length at which a capture stops: a minute short of `maxSplitSourceMs`, since the last
    /// buffer lands after the check and the saved length must stay within it.
    public static let captureStopMs: Int64 = maxSplitSourceMs - 60_000
    public static let maxSplitPieces = 50
    /// The shortest piece a split or a trim leaves, as `MIN_TRIM_MS` in
    /// `api/src/crosstune/vocabulary.py` enforces.
    public static let minLengthMs: Int64 = 1000

    /// Why a split's pieces cannot be saved.
    public enum PieceProblem: Error, Equatable, Sendable {
        case tooMany
        case tooShort
        case tooLong
    }

    /// Where a split of `recording` ends on its source timeline: its trim end, else its source
    /// length. A recording not yet uploaded has its length only on the local file.
    public static func splitRangeEnd(_ recording: Recording, file: RecordingFile?) -> Int64? {
        recording.trimEndMs ?? recording.sourceDurationMs ?? recording.durationMs ?? file?.localDurationMs
    }

    /// What is wrong with the pieces between ascending `edges` (the range's start, each cut, and
    /// its end), or nil when they can be saved.
    public static func pieceProblem(edges: [Int64]) -> PieceProblem? {
        guard edges.count - 1 <= maxSplitPieces else { return .tooMany }
        let lengths = zip(edges, edges.dropFirst()).map { $1 - $0 }
        if lengths.contains(where: { $0 < minLengthMs }) { return .tooShort }
        // No piece may be longer than the server keeps.
        if lengths.contains(where: { $0 > maxRecordingMs }) { return .tooLong }
        return nil
    }

    /// True when a captured file is longer or larger than the server accepts and no split has
    /// been requested for it; only a split parent may upload past the plain per-file cap.
    /// `uploadLimits` are the server's caps, nil until it has reported them. A file too long or
    /// too large even for a split parent is not held: its upload meets the server's refusal.
    public static func mustSplitToUpload(
        _ recording: Recording, file: RecordingFile?, uploadLimits: StorageUsage?
    ) -> Bool {
        guard recording.splitID == nil, let file, file.localState != .uploaded else { return false }
        let ms = file.localDurationMs
        func over(_ cap: Int?) -> Bool {
            guard let cap, let bytes = file.bytes else { return false }
            return bytes > Int64(cap)
        }
        if let ms, ms > maxSplitSourceMs { return false }
        if over(uploadLimits?.splitParentMaxFileBytes) { return false }
        return (ms.map { $0 > maxRecordingMs } ?? false) || over(uploadLimits?.maxFileBytes)
    }

    /// A split is incomplete until the server marks the latest one complete.
    public static func splitIncomplete(_ parent: Recording) -> Bool {
        guard let splitID = parent.splitID else { return false }
        return parent.splitCompletedID != splitID
    }

    /// A piece still waiting for the server to cut it, which plays from its parent's audio and
    /// cannot be split yet.
    public static func waitsForCut(_ piece: Recording) -> Bool {
        piece.splitFromID != nil && piece.deletedAt == nil && piece.state == "processing"
    }

    /// Whether a parent recording's audio must stay, and its Delete wait: it has not failed and
    /// a live piece split from it is still waiting for its cut. The server's purge holds the
    /// parent's original by the same rule.
    public static func holdsSplitAudio(_ parent: Recording, waitingParentIDs: Set<String>) -> Bool {
        parent.state != "failed" && waitingParentIDs.contains(parent.id)
    }

    /// The parents of every piece among `pieces` still waiting for its cut. `excluding` names
    /// pieces about to be deleted, which no longer hold their parent.
    public static func waitingParentIDs(in pieces: [Recording], excluding: Set<String> = []) -> Set<String> {
        Set(pieces.filter { waitsForCut($0) && !excluding.contains($0.id) }.compactMap(\.splitFromID))
    }

    /// Every row split from another, waiting for its cut or not.
    public static func splitPieces(_ db: Database) throws -> [Recording] {
        try Recording.filter(Recording.CodingKeys.splitFromID != nil).fetchAll(db)
    }

    /// The parents of every live piece still waiting for its cut. `excludingPieceIDs` are pieces
    /// about to be deleted, which no longer hold their parent.
    public static func waitingParentIDs(_ db: Database, excludingPieceIDs: Set<String> = []) throws -> Set<String> {
        waitingParentIDs(in: try splitPieces(db), excluding: excludingPieceIDs)
    }

    /// The recordings a tune delete keeps, unfiled, among `recordings`, the rows filed under the
    /// tunes it deletes: each parent whose waiting piece plays from its audio, unless that piece
    /// goes with the same delete. `pieces` are the rows ``splitPieces(_:)`` reads.
    public static func keptByTuneDelete(_ recordings: [Recording], pieces: [Recording]) -> Set<String> {
        let waiting = waitingParentIDs(in: pieces, excluding: Set(recordings.map(\.id)))
        return Set(
            recordings.filter { $0.deletedAt == nil && holdsSplitAudio($0, waitingParentIDs: waiting) }.map(\.id))
    }

    /// The recordings filed under `tuneIDs` that a delete of those tunes keeps, unfiled.
    public static func keptByTuneDelete(_ db: Database, tuneIDs: some Collection<String>) throws -> Set<String> {
        let recordings = try Recording.filter(tuneIDs.contains(Recording.CodingKeys.tuneID)).fetchAll(db)
        return keptByTuneDelete(recordings, pieces: try splitPieces(db))
    }

    public static func pieceLabel(_ parentLabel: String?, number: Int) -> String {
        let trimmed = parentLabel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Part \(number)" : "\(trimmed), part \(number)"
    }
}
