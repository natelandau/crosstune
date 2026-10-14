import CrosstuneAnalytics
import CrosstuneStore
import Foundation
import GRDB
import os

extension Transfers {
    /// When this device keeps recordings offline and the plan plays them, fetches the audio and
    /// waveform of every ready recording whose copy is missing or stale, as after a trim, up to
    /// ``downloadConcurrency`` recordings at a time. `fetch` and `fetchPeaksFor` share one
    /// attempt per recording with a play or another caller that asks for it.
    func downloadPass(
        fetch: @escaping @MainActor (String) async throws -> URL?,
        fetchPeaksFor: @escaping @MainActor (String) async throws -> Data?
    ) async throws {
        guard try await store.meta(.keepOffline, as: Bool.self) == true,
            try await store.plan(at: now()).recordingsPlay
        else { return }
        let (rows, files) = try await store.read { db -> ([Recording], [String: RecordingFile]) in
            let rows = try Recording.fetchAll(db, sql: Self.needingDownloadSQL)
            let files = Dictionary(
                uniqueKeysWithValues: try RecordingFile.fetchAll(db, keys: rows.map(\.id)).map { ($0.id, $0) })
            return (rows, files)
        }
        try await forEachDownload(rows) { [self] row in
            try await download(row, file: files[row.id], fetch: fetch, fetchPeaksFor: fetchPeaksFor)
        }
    }

    /// Ready live recordings whose audio is missing or stale, or whose waveform is behind, as
    /// `download(_:file:fetch:fetchPeaksFor:)` decides it.
    private nonisolated static let needingDownloadSQL = """
        SELECT r.* FROM recordings r
        LEFT JOIN recording_files f ON f.id = r.id
        WHERE r.deleted_at IS NULL AND r.state = 'ready' AND (
            f.file_name IS NULL
            OR (f.blob_rev IS NOT NULL AND f.blob_rev IS NOT r.playback_rev)
            OR (r.peaks_rev IS NOT NULL AND f.peaks_rev IS NOT r.peaks_rev))
        """

    /// One recording's share of the download pass: its audio when missing or stale, then its
    /// waveform when behind.
    private func download(
        _ row: Recording, file: RecordingFile?,
        fetch: @MainActor (String) async throws -> URL?,
        fetchPeaksFor: @MainActor (String) async throws -> Data?
    ) async throws {
        var current = file
        let needsAudio = file?.fileName == nil || file.map { isStale(row, $0) } == true
        if needsAudio, !downloadRetries.isWaiting(row.id) {
            do {
                _ = try await fetch(row.id)
                downloadRetries.succeeded(row.id)
            } catch {
                // A stop, no connection, or a refused session ends the pass; anything else is
                // this recording's problem alone, so it is noted and the rest still download.
                if endsTheDownloadPass(error) { throw error }
                downloadRetries.failed(row.id)
                if let file {
                    try await setFileState(row.id, restingState(file.localState), error: transferMessage(error))
                }
            }
            // Re-read: the fetch may have just stored the waveform that came with a fresh file.
            current = try await store.read { db in try RecordingFile.fetchOne(db, key: row.id) }
        }

        let peaksKey = "peaks:\(row.id)"
        guard let peaksRev = row.peaksRev, !downloadRetries.isWaiting(peaksKey), current?.peaksRev != peaksRev
        else { return }
        do {
            _ = try await fetchPeaksFor(row.id)
            downloadRetries.succeeded(peaksKey)
        } catch {
            // A missing waveform never fails the pass; it just waits for the next one, backed off.
            downloadRetries.failed(peaksKey)
        }
    }

    /// The recording's audio on this device, fetched first when it is not here. Nil when there
    /// is nothing to fetch: the recording is gone or not ready.
    func downloadOne(_ id: String) async throws -> URL? {
        let (file, row) = try await store.read { db in
            (try RecordingFile.fetchOne(db, key: id), try Recording.fetchOne(db, key: id))
        }
        if let file, let local = store.localAudio(file), !(row.map { isStale($0, file) } ?? false) {
            return local
        }
        guard let row, row.deletedAt == nil, row.state == "ready" else { return nil }
        // Before the first write, so a stopped engine leaves the store as it found it.
        try checkStopped()
        let previousState = file.map { restingState($0.localState) }
        try await setFileState(id, .downloading)
        var destination: URL?
        do {
            try checkStopped()
            // A pull runs on its own loop and a trim can commit mid-download, so the row's own
            // playbackRev and start can already be behind this response by the time it lands.
            // What the server signed, not what this device has pulled, is what the downloaded
            // bytes are tagged and named for: a stale file keeps its own path until the row
            // switches to the new one, so a player already holding it open is never pulled out
            // from under.
            let signed = try await api.downloadURL(recordingID: id)
            try checkStopped()
            let name = try downloadedFileName(id, rev: signed.playbackRev, contentType: row.playbackMime)
            let newDestination = store.audioFolder.appending(path: name)
            destination = newDestination
            try await api.getObject(signed.url, to: newDestination)
            try CrosstuneStore.setExcludedFromBackup(newDestination, true)
            let bytes = try fileSize(newDestination)
            try await store.writeDroppingFiles { writer in
                var stored =
                    try RecordingFile.fetchOne(writer.db, key: id) ?? RecordingFile(id: id, localState: .downloaded)
                stored.localState = .downloaded
                stored.fileName = name
                stored.contentType = row.playbackMime
                stored.bytes = bytes
                stored.blobRev = signed.playbackRev
                stored.blobStartMs = signed.playbackStartMs
                stored.error = nil
                stored.updatedAt = .now
                try stored.save(writer.db)
            }
            // A waveform that fails to fetch never undoes an audio download that already succeeded.
            try? await refreshPeaks(id)
            return newDestination
        } catch {
            if let destination { try? FileManager.default.removeItem(at: destination) }
            // A file with no row before downloading gets none back; setFileState passes it by.
            if let previousState { try? await setFileState(id, previousState) }
            throw error
        }
    }

    /// The recording's current waveform, fetched from the server first when this device's copy
    /// does not match its current revision. A row whose waveform has not been built yet, or that
    /// is gone or not ready, keeps whatever is already on disk: capture-time peaks, a server
    /// waveform from an earlier revision, or none.
    @discardableResult
    func fetchPeaks(_ id: String) async throws -> Data? {
        switch try await updatePeaks(id) {
        case .kept(let file): store.localPeaks(file)
        case .fetched(let destination): try Data(contentsOf: destination)
        }
    }

    /// Brings the recording's waveform up to date as ``fetchPeaks(_:)`` does, without reading it.
    func refreshPeaks(_ id: String) async throws {
        _ = try await updatePeaks(id)
    }

    private enum PeaksUpdate {
        /// Nothing to fetch, so the file row's own waveform stands.
        case kept(RecordingFile?)
        case fetched(URL)
    }

    private func updatePeaks(_ id: String) async throws -> PeaksUpdate {
        let (file, row) = try await store.read { db in
            (try RecordingFile.fetchOne(db, key: id), try Recording.fetchOne(db, key: id))
        }
        guard let row, row.deletedAt == nil, row.state == "ready", let peaksRev = row.peaksRev else {
            return .kept(file)
        }
        if let file, file.peaksRev == peaksRev { return .kept(file) }
        try checkStopped()
        // As with the audio download, tag the bytes with what the server actually signed, not
        // with this row's own peaksRev, which can already be behind it.
        let signed = try await api.peaksURL(recordingID: id)
        try checkStopped()
        let name = try peaksFileName(id, rev: signed.peaksRev)
        let destination = store.audioFolder.appending(path: name)
        try await api.getObject(signed.url, to: destination)
        try await store.writeDroppingFiles { writer in
            // A recording whose audio has never landed here still gets its waveform: there is
            // nothing local to upload, so `uploaded` is the state that lies least.
            var stored =
                try RecordingFile.fetchOne(writer.db, key: id) ?? RecordingFile(id: id, localState: .uploaded)
            stored.peaksFileName = name
            stored.peaksRev = signed.peaksRev
            stored.updatedAt = .now
            try stored.save(writer.db)
        }
        return .fetched(destination)
    }

    /// A stale `downloading` state is an earlier fetch that never finished, not a state to keep:
    /// it rests as a completed fetch that produced no file.
    private func restingState(_ state: LocalFileState) -> LocalFileState {
        state == .downloading ? .downloaded : state
    }

    func setFileState(_ id: String, _ state: LocalFileState, error: String? = nil) async throws {
        try await store.write { writer in
            try writer.updateFile(id) { file in
                file.localState = state
                file.error = error
            }
        }
    }
}
