@preconcurrency import AVFoundation
import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "recording")

/// Turns capture files in a user's audio folder into recordings, or throws them away.
public struct CaptureFinisher: Sendable {
    public let store: CrosstuneStore

    public init(store: CrosstuneStore) {
        self.store = store
    }

    public func captureURL(_ recordingID: String) -> URL {
        store.audioFolder.appending(path: CaptureFiles.captureName(recordingID))
    }

    public func finishedURL(_ recordingID: String) -> URL {
        store.audioFolder.appending(path: CaptureFiles.finishedName(recordingID))
    }

    /// Exports a capture to `.m4a` without re-encoding, deletes the capture, and writes the
    /// recording. A capture with no audio in it is discarded instead, and this returns false.
    ///
    /// Every step can be repeated: an export a crash cut short is redone, and a finished file
    /// whose capture is already gone is recorded as it is.
    @discardableResult
    public func finish(_ recordingID: String) async throws -> Bool {
        let capture = captureURL(recordingID)
        let finished = finishedURL(recordingID)
        if CaptureFiles.exists(capture) {
            guard try await hasAudio(capture) else {
                try await discard(recordingID)
                return false
            }
            try CaptureFiles.removeIfPresent(finished)
            try await export(capture, to: finished)
            try CaptureFiles.removeIfPresent(capture)
        }
        guard CaptureFiles.exists(finished) else {
            try await Commands(store: store).cancelCapture(recordingID)
            return false
        }
        let duration = try await AVURLAsset(url: finished).load(.duration)
        return try await Commands(store: store).finishCapture(
            recordingID, fileName: CaptureFiles.finishedName(recordingID), bytes: CaptureFiles.size(of: finished),
            durationMs: Int64((duration.seconds * 1000).rounded()))
    }

    /// Deletes a capture's audio and forgets it, writing no recording.
    public func discard(_ recordingID: String) async throws {
        try CaptureFiles.removeIfPresent(captureURL(recordingID))
        try CaptureFiles.removeIfPresent(finishedURL(recordingID))
        try await Commands(store: store).cancelCapture(recordingID)
    }

    /// Finishes every capture a previous run of the app left behind. A capture in `skipping`,
    /// or one begun at or after `cutoff`, is still recording and left alone. A capture file
    /// with no row, as after the store started over, is recorded unfiled, dated when the file
    /// was created.
    ///
    /// A capture that fails stays for the next recovery and the rest go on. Returns the IDs
    /// that failed, each logged with its error.
    @discardableResult
    public func recoverLeftovers(skipping: Set<String> = [], startedBefore cutoff: Timestamp = .now) async
        -> [String]
    {
        var failed: [String] = []
        func attempt(_ recordingID: String, _ body: () async throws -> Void) async {
            do {
                try await body()
            } catch {
                failed.append(recordingID)
                logger.error("Could not recover capture \(recordingID, privacy: .public): \(error)")
            }
        }
        let commands = Commands(store: store)
        let capturing: [RecordingFile]
        do {
            capturing = try await commands.capturingFiles()
        } catch {
            logger.error("Could not list unfinished captures: \(error)")
            capturing = []
        }
        for file in capturing where !skipping.contains(file.id) && file.recordedAt.map({ $0 < cutoff }) ?? true {
            await attempt(file.id) { try await finish(file.id) }
        }
        for recordingID in CaptureFiles.captureIDs(in: store.audioFolder)
        where !skipping.contains(recordingID) && !failed.contains(recordingID) {
            await attempt(recordingID) { try await recoverFile(recordingID, cutoff: cutoff) }
        }
        return failed
    }

    /// Finishes a capture file found in the folder, as when its row was lost.
    private func recoverFile(_ recordingID: String, cutoff: Timestamp) async throws {
        let capture = captureURL(recordingID)
        let values = try? capture.resourceValues(forKeys: [.creationDateKey, .contentModificationDateKey])
        let fileDate = (values?.creationDate ?? values?.contentModificationDate).map(Timestamp.init)
        if let fileDate, fileDate >= cutoff { return }
        if let row = try await store.read({ db in try RecordingFile.fetchOne(db, key: recordingID) }) {
            // A finished recording whose capture's deletion was lost. A capturing row's file is
            // still being written, and a file its row names is that recording's audio, such as
            // an imported AAC file.
            if row.localState != .capturing, row.fileName != capture.lastPathComponent {
                try CaptureFiles.removeIfPresent(capture)
            }
            return
        }
        try await Commands(store: store).beginCapture(
            recordingID, fileName: CaptureFiles.captureName(recordingID), tuneID: nil,
            recordedAt: fileDate ?? .now)
        try await finish(recordingID)
    }

    /// False only for a capture that is empty or whose audio lasts no time. A file that cannot
    /// be read throws instead, so it stays to be tried again rather than deleted.
    private func hasAudio(_ url: URL) async throws -> Bool {
        guard CaptureFiles.exists(url), try CaptureFiles.size(of: url) > 0 else { return false }
        return try await AVURLAsset(url: url).load(.duration).seconds > 0
    }

    private func export(_ capture: URL, to finished: URL) async throws {
        guard
            let session = AVAssetExportSession(
                asset: AVURLAsset(url: capture), presetName: AVAssetExportPresetPassthrough)
        else { throw CaptureError.unsupportedFormat }
        try await session.export(to: finished, as: .m4a)
    }
}
