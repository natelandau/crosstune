import CrosstuneStore
import Foundation
import GRDB

/// The name a new recording gets: when it started, as the local `YYYY-MM-DD HH:MM`. `timeZone`
/// defaults to the device's own so a caller only overrides it in a test.
public func defaultRecordingLabel(recordedAt: Timestamp, timeZone: TimeZone = .current) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: recordedAt.date)
    return String(
        format: "%04d-%02d-%02d %02d:%02d", parts.year!, parts.month!, parts.day!, parts.hour!, parts.minute!)
}

/// A tune's recordings that have not been tombstoned, in position order.
private func activeRecordings(tuneID: String, db: Database) throws -> [Recording] {
    activeByPosition(try Recording.filter(Column("tune_id") == tuneID).fetchAll(db))
}

/// The type every finished capture is stored as.
public let capturedContentType = "audio/mp4"

extension StoreWriter {
    public func activeRecordingsForTune(_ tuneID: String) throws -> [Recording] {
        try activeRecordings(tuneID: tuneID, db: db)
    }

    /// Marks a capture as in progress before its first audio is written, so a capture the app
    /// never finished is found and recovered the next time the store opens.
    public func beginCapture(
        _ recordingID: String, fileName: String, tuneID: String?, recordedAt: Timestamp, at time: Timestamp = .now
    ) throws {
        try RecordingFile(
            id: recordingID, localState: .capturing, fileName: fileName, tuneID: tuneID, recordedAt: recordedAt,
            updatedAt: time
        ).save(db)
    }

    /// Turns a capture into a recording: its finished file becomes `captured`, waiting to upload,
    /// and the recording row is queued under the tune the capture began for, when that tune still
    /// exists. Returns false when the capture was already finished or cancelled.
    @discardableResult
    public func finishCapture(
        _ recordingID: String, fileName: String, bytes: Int64, durationMs: Int64, at time: Timestamp = .now
    ) throws -> Bool {
        guard let file = try RecordingFile.fetchOne(db, key: recordingID), file.localState == .capturing else {
            return false
        }
        let recordedAt = file.recordedAt ?? time
        let tuneID = try file.tuneID.flatMap { id in try Tune.fetchOne(db, key: id)?.deletedAt == nil ? id : nil }
        try RecordingFile(
            id: recordingID, localState: .captured, fileName: fileName, contentType: capturedContentType,
            bytes: bytes, localDurationMs: durationMs, updatedAt: time
        ).update(db)
        try putNewRecording(
            recordingID, tuneID: tuneID, source: "microphone",
            // Named for when it started, so a recording is never nameless in a list.
            label: defaultRecordingLabel(recordedAt: recordedAt), recordedAt: recordedAt, at: time)
        return true
    }

    /// Forgets a capture that is still in progress. A finished one is left alone, since its
    /// recording row already depends on it.
    public func cancelCapture(_ recordingID: String) throws {
        guard let file = try RecordingFile.fetchOne(db, key: recordingID), file.localState == .capturing else {
            return
        }
        try file.delete(db)
    }

    /// Adds a recording from an audio file already copied into the user's audio folder.
    public func addUploadedFile(
        _ recordingID: String = newID(), fileName: String, contentType: String?, bytes: Int64, tuneID: String?,
        label: String?, recordedAt: Timestamp, at time: Timestamp = .now
    ) throws -> String {
        try RecordingFile(
            id: recordingID, localState: .captured, fileName: fileName,
            contentType: contentType ?? "application/octet-stream", bytes: bytes, updatedAt: time
        ).save(db)
        try putNewRecording(
            recordingID, tuneID: tuneID, source: "upload", label: label, recordedAt: recordedAt, at: time)
        return recordingID
    }

    private func putNewRecording(
        _ recordingID: String, tuneID: String?, source: String, label: String?, recordedAt: Timestamp,
        at time: Timestamp
    ) throws {
        let siblings = try tuneID.map(activeRecordingsForTune) ?? []
        try put(
            Recording(
                id: recordingID, createdAt: time, tuneID: tuneID, source: source, recordedAt: recordedAt,
                label: label, position: nextPosition(siblings)),
            at: time)
    }

    /// Applies a label or tune change to a recording. Moving it to a different, live tune
    /// repositions it past that tune's other recordings; clearing its tune keeps its position.
    /// A failed upload is put back in the queue, since the edit re-pushes the row.
    public func updateRecording(
        _ recordingID: String, label: Patch<String?> = .keep, tuneID: Patch<String?> = .keep,
        at time: Timestamp = .now
    ) throws {
        guard var recording = try Recording.fetchOne(db, key: recordingID), recording.deletedAt == nil else {
            throw CommandError.recordingNotFound
        }
        if case .value(let newTuneID) = tuneID, let newTuneID, newTuneID != recording.tuneID {
            guard let tune = try Tune.fetchOne(db, key: newTuneID), tune.deletedAt == nil else {
                throw CommandError.tuneNotFound
            }
            recording.position = nextPosition(try activeRecordingsForTune(newTuneID))
        }
        recording.label = label.resolved(from: recording.label)
        recording.tuneID = tuneID.resolved(from: recording.tuneID)
        try put(recording, at: time)

        if var file = try RecordingFile.fetchOne(db, key: recordingID), file.localState == .failedUpload {
            file.localState = .captured
            file.error = nil
            file.updatedAt = time
            try file.update(db)
        }
    }

    /// Puts a file that failed to upload, or keeps failing, back at the front of the queue. The
    /// next transfer pass sends it.
    public func retryUpload(_ recordingID: String, at time: Timestamp = .now) throws {
        guard var file = try RecordingFile.fetchOne(db, key: recordingID),
            file.localState == .failedUpload || file.localState == .captured
        else { return }
        file.localState = .captured
        file.error = nil
        file.uploadAttempts = 0
        file.nextAttemptAt = nil
        file.updatedAt = time
        try file.update(db)
    }

    /// Lets go of audio this device can fetch again. Only a ready recording's audio is on the
    /// server to fetch; one still waiting, blocked, failed, or processing is the only copy.
    public func clearDownloadedAudio(at time: Timestamp = .now) throws {
        let candidates = try RecordingFile.filter(
            [LocalFileState.uploaded, .downloaded].contains(RecordingFile.CodingKeys.localState)
                && RecordingFile.CodingKeys.fileName != nil
        ).fetchAll(db)
        for var file in candidates {
            guard let row = try Recording.fetchOne(db, key: file.id), row.deletedAt == nil, row.state == "ready"
            else { continue }
            file.fileName = nil
            file.bytes = 0
            file.updatedAt = time
            try file.update(db)
        }
    }

    /// Tombstones a recording and drops its local audio file entry.
    public func deleteRecording(_ recordingID: String, at time: Timestamp = .now) throws {
        try tombstone(Recording.self, id: recordingID, at: time)
        try RecordingFile.deleteOne(db, key: recordingID)
    }
}

extension Commands {
    public func beginCapture(
        _ recordingID: String, fileName: String, tuneID: String?, recordedAt: Timestamp, at time: Timestamp = .now
    ) async throws {
        try await store.write { writer in
            try writer.beginCapture(recordingID, fileName: fileName, tuneID: tuneID, recordedAt: recordedAt, at: time)
        }
    }

    @discardableResult
    public func finishCapture(
        _ recordingID: String, fileName: String, bytes: Int64, durationMs: Int64, at time: Timestamp = .now
    ) async throws -> Bool {
        try await store.write { writer in
            try writer.finishCapture(recordingID, fileName: fileName, bytes: bytes, durationMs: durationMs, at: time)
        }
    }

    public func cancelCapture(_ recordingID: String) async throws {
        try await store.write { writer in try writer.cancelCapture(recordingID) }
    }

    @discardableResult
    public func addUploadedFile(
        _ recordingID: String = newID(), fileName: String, contentType: String?, bytes: Int64, tuneID: String?,
        label: String?, recordedAt: Timestamp, at time: Timestamp = .now
    ) async throws -> String {
        try await store.write { writer in
            try writer.addUploadedFile(
                recordingID, fileName: fileName, contentType: contentType, bytes: bytes, tuneID: tuneID, label: label,
                recordedAt: recordedAt, at: time)
        }
    }

    /// Recordings that are still capturing, as left by a capture the app never finished.
    public func capturingFiles() async throws -> [RecordingFile] {
        try await store.read { db in
            try RecordingFile.filter(RecordingFile.CodingKeys.localState == LocalFileState.capturing).fetchAll(db)
        }
    }

    public func activeRecordingsForTune(_ tuneID: String) async throws -> [Recording] {
        try await store.read { db in try activeRecordings(tuneID: tuneID, db: db) }
    }

    public func updateRecording(
        _ recordingID: String, label: Patch<String?> = .keep, tuneID: Patch<String?> = .keep,
        at time: Timestamp = .now
    ) async throws {
        try await store.write { writer in
            try writer.updateRecording(recordingID, label: label, tuneID: tuneID, at: time)
        }
    }

    public func retryUpload(_ recordingID: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.retryUpload(recordingID, at: time) }
    }

    /// Deletes the audio of every ready recording from this device. It downloads again when
    /// played.
    public func clearDownloadedAudio(at time: Timestamp = .now) async throws {
        try await store.writeDroppingAudio { writer in try writer.clearDownloadedAudio(at: time) }
    }

    /// Deletes a recording, its local file row, and its audio on this device.
    public func deleteRecording(_ recordingID: String, at time: Timestamp = .now) async throws {
        try await store.writeDroppingAudio { writer in try writer.deleteRecording(recordingID, at: time) }
    }
}
