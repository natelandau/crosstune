@preconcurrency import AVFoundation
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneRecording
import CrosstuneShare
import CrosstuneStore
import CrosstuneSync
import Foundation
import UniformTypeIdentifiers

/// Adds an audio file already on the device, or in Files, as a recording.
public enum RecordingImport {
    /// The toolbar control that picks a file.
    public static let upload = "Upload"
    public static let uploadAudio = "Upload audio files"

    /// Copies the file at `url` into the user's audio folder and adds it as a recording, named
    /// for the file unless a `label` is given, filed under `tuneID` or unfiled. Returns the new
    /// recording's ID, which is `recordingID` when given.
    ///
    /// Throws an ``AudioFileCheck/Reason`` only for a file no retry can add. Any other error, such as a full disk
    /// or an export the system interrupted, may pass on a later try.
    @discardableResult
    public static func add(
        _ url: URL, to store: CrosstuneStore, tuneID: String?, label: String? = nil, at time: Timestamp = .now,
        recordingID: String = newID()
    ) async throws -> String {
        // A file from the picker is outside the app's sandbox until access is asked for.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.contentTypeKey, .fileSizeKey])
        guard let type = values.contentType else { throw AudioFileCheck.Reason.notAudio }
        let isQuickTime = await isQuickTimeAudio(url, type: type)
        let bytes = Int64(values.fileSize ?? 0)
        // Read at the moment of the check, so a file picked right after launch is held to the
        // stored limit rather than slipping past one not yet read.
        let maxFileBytes = try await store.meta(.storage, as: StorageUsage.self)?.maxFileBytes
        // A QuickTime file is checked as the M4A type it is stored as, but at its original size, so
        // a file the limit refuses is never converted. The converted file's size is checked below.
        if let reason = AudioFileCheck.reason(
            type: isQuickTime ? .mpeg4Audio : type, bytes: bytes, maxFileBytes: maxFileBytes)
        {
            throw reason
        }
        guard let mime = isQuickTime ? "audio/mp4" : type.preferredMIMEType else {
            throw AudioFileCheck.Reason.notAudio
        }
        // The API accepts no QuickTime type, so those files are stored as M4A.
        let ext = isQuickTime ? "m4a" : (type.preferredFilenameExtension ?? url.pathExtension)
        // Never the bare recording ID: an AAC file would then read as a capture to recovery.
        let base = "\(recordingID)-import"
        let fileName = ext.isEmpty ? base : "\(base).\(ext)"
        let destination = store.audioFolder.appending(path: fileName)
        // A retry with the same recording ID finds what an interrupted try left here.
        try? FileManager.default.removeItem(at: destination)
        var storedBytes = bytes
        if isQuickTime {
            // The stored file is the re-encoded M4A, so the server's limit applies to its size.
            storedBytes = try await exportM4A(url, to: destination)
            if let reason = AudioFileCheck.reason(type: .mpeg4Audio, bytes: storedBytes, maxFileBytes: maxFileBytes) {
                try? FileManager.default.removeItem(at: destination)
                throw reason
            }
        } else {
            try await copy(url, to: destination)
        }
        let peaksFileName = await writePeaks(recordingID, from: destination, in: store)
        do {
            return try await Commands(store: store).addUploadedFile(
                recordingID, fileName: fileName, contentType: mime, bytes: storedBytes, tuneID: tuneID,
                label: clippedRecordingLabel(label ?? url.deletingPathExtension().lastPathComponent),
                peaksFileName: peaksFileName, at: time)
        } catch {
            cleanUpAfterFailure(fileName: fileName, peaksFileName: peaksFileName, in: store)
            throw error
        }
    }

    /// Removes what `add` had already written to the audio folder once a later step failed, so a
    /// refused or aborted import leaves nothing behind.
    static func cleanUpAfterFailure(fileName: String, peaksFileName: String?, in store: CrosstuneStore) {
        try? FileManager.default.removeItem(at: store.audioFolder.appending(path: fileName))
        if let peaksFileName {
            try? FileManager.default.removeItem(at: store.audioFolder.appending(path: peaksFileName))
        }
    }

    /// A QuickTime audio file, or a QuickTime movie holding no video, which Voice Memos shares as `.qta`.
    private static func isQuickTimeAudio(_ url: URL, type: UTType) async -> Bool {
        if AudioFileCheck.isQuickTimeAudio(type) { return true }
        guard type.conforms(to: .quickTimeMovie) else { return false }
        let asset = AVURLAsset(url: url)
        guard let video = try? await asset.loadTracks(withMediaType: .video),
            let audio = try? await asset.loadTracks(withMediaType: .audio)
        else { return false }
        return video.isEmpty && !audio.isEmpty
    }

    /// Mixes every audio track into one so a layered memo stays whole. Returns the exported size.
    /// A failed export leaves nothing at `destination`. Refuses only a file that holds no audio
    /// AVFoundation can read; any other failure, such as the app leaving the foreground mid-export
    /// or a full disk, is thrown as it is, since a later try may pass.
    private static func exportM4A(_ source: URL, to destination: URL) async throws -> Int64 {
        let asset = AVURLAsset(url: source)
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw AudioFileCheck.Reason.notAudio
        }
        do {
            guard try await !asset.loadTracks(withMediaType: .audio).isEmpty else {
                throw AudioFileCheck.Reason.notAudio
            }
            try await session.export(to: destination, as: .m4a)
            return Int64(try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
        } catch {
            try? FileManager.default.removeItem(at: destination)
            if isUnreadable(error) { throw AudioFileCheck.Reason.notAudio }
            throw error
        }
    }

    /// Whether `error` says the file holds no audio that can be read, which no retry changes.
    private static func isUnreadable(_ error: any Error) -> Bool {
        if error is AudioFileCheck.Reason { return true }
        guard let error = error as? AVError else { return false }
        let unreadable: Set<AVError.Code> = [
            .fileFormatNotRecognized, .fileFailedToParse, .decodeFailed, .undecodableMediaData,
        ]
        return unreadable.contains(error.code)
    }

    /// Copies off the main actor, since an audio file can run to hundreds of megabytes.
    @concurrent
    private static func copy(_ source: URL, to destination: URL) async throws {
        try FileManager.default.copyItem(at: source, to: destination)
    }

    /// Decodes the imported file's waveform and writes it beside the audio. An import with no
    /// waveform is still a usable recording, just without one to draw, so a failure here is
    /// swallowed rather than failing the import.
    private static func writePeaks(_ recordingID: String, from source: URL, in store: CrosstuneStore) async -> String? {
        guard let peaks = try? await Peaks.read(from: source) else { return nil }
        return try? peaks.write(for: recordingID, in: store)
    }
}
