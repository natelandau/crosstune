import CrosstuneStore
import Foundation
import GRDB

/// The scans and lyrics the Stand shows beside the practice waveform for whatever is playing.
struct StandReading: Equatable, Sendable {
    let tuneID: String
    let scans: [Scan]
    /// Nil when the tune has no lyrics, or only whitespace.
    let lyrics: String?

    var isEmpty: Bool { scans.isEmpty && lyrics == nil }

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

    /// What there is to read for that tune; nil when there is no tune, it is gone, or it has nothing.
    nonisolated static func fetch(_ db: Database, item: PlayerItem?, listTuneID: String?) throws -> StandReading? {
        guard let tuneID = try tuneID(db, item: item, listTuneID: listTuneID),
            let tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil
        else { return nil }
        let lyrics = tune.lyrics.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        let reading = StandReading(tuneID: tuneID, scans: try Scan.fetch(db, tuneID: tuneID), lyrics: lyrics)
        return reading.isEmpty ? nil : reading
    }
}
