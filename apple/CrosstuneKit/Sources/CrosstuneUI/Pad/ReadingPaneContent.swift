import CrosstuneStore
import Foundation
import GRDB

/// The scans and lyrics the practice screen shows beside the practice waveform for whatever is playing.
struct ReadingPaneContent: Equatable, Sendable {
    let tuneID: String
    let scans: [Scan]
    /// Nil when the tune has no lyrics, or only whitespace.
    let lyrics: String?

    var isEmpty: Bool { scans.isEmpty && lyrics == nil }

    /// The reading without its scans when the plan does not open them, nil when that leaves
    /// nothing to read.
    func withScans(opening opens: Bool) -> ReadingPaneContent? {
        guard !opens, !scans.isEmpty else { return self }
        let rest = ReadingPaneContent(tuneID: tuneID, scans: [], lyrics: lyrics)
        return rest.isEmpty ? nil : rest
    }

    /// The tune a playing list is on, else the loaded recording's or link's tune.
    nonisolated static func tuneID(_ db: Database, item: PlayerItem?, listTuneID: String?) throws -> String? {
        if let listTuneID { return listTuneID }
        guard let item else { return nil }
        switch item.kind {
        case .recording:
            // The stored row before the player's snapshot, which keeps a take's tune from before a refile.
            let recording = try Recording.fetchOne(db, key: item.id) ?? item.recording
            return recording?.tuneID
        case .link:
            return try RecordingLink.fetchOne(db, key: item.id)?.tuneID
        }
    }

    /// The tune on the practice screen and what there is to read for it; no tune when there is
    /// none or it is gone.
    nonisolated static func read(_ db: Database, item: PlayerItem?, listTuneID: String?) throws -> ReadingPaneTune {
        guard let tuneID = try tuneID(db, item: item, listTuneID: listTuneID),
            let tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil
        else { return ReadingPaneTune(tuneID: nil, reading: nil) }
        let lyrics = tune.lyrics.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        let reading = ReadingPaneContent(tuneID: tuneID, scans: try Scan.fetch(db, tuneID: tuneID), lyrics: lyrics)
        return ReadingPaneTune(tuneID: tuneID, reading: reading.isEmpty ? nil : reading)
    }
}

/// The tune the practice screen is on, which a visit reports whether or not it has anything to read.
struct ReadingPaneTune: Equatable, Sendable {
    let tuneID: String?
    /// Nil when the tune has nothing to read.
    let reading: ReadingPaneContent?
}
