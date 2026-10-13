import CrosstuneStore
import Foundation
import GRDB

extension CrosstuneStore {
    /// The account's plan at `now`, judged from the stored entitlements row.
    func plan(at now: Date) async throws -> Plan {
        try await read { db in Plan.from(try Entitlement.current(db), now: now) }
    }

    /// The file a recording's row names, when it holds finished audio that is still on disk.
    public func localAudio(_ file: RecordingFile?) -> URL? {
        guard let file, let name = file.fileName, file.localState != .capturing, file.localState != .downloading
        else { return nil }
        let url = audioFolder.appending(path: name)
        return FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) ? url : nil
    }

    /// The recording's audio on this device, without fetching it: what plays with no sync engine.
    public func localAudio(recordingID: String) async -> URL? {
        let file = try? await read { db in try RecordingFile.fetchOne(db, key: recordingID) }
        return localAudio(file ?? nil)
    }

    /// The bytes of the waveform a recording's row names, when it is still on disk.
    public func localPeaks(_ file: RecordingFile?) -> Data? {
        guard let file, let name = file.peaksFileName else { return nil }
        return try? Data(contentsOf: audioFolder.appending(path: name))
    }

    /// The recording's waveform bytes on this device, without fetching it: what shows offline or
    /// with no sync engine.
    public func localPeaks(recordingID: String) async -> Data? {
        let file = try? await read { db in try RecordingFile.fetchOne(db, key: recordingID) }
        return localPeaks(file ?? nil)
    }
}
