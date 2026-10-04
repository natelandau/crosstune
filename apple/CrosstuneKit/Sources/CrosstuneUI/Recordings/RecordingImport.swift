import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import Foundation
import UniformTypeIdentifiers

/// Adds an audio file already on the device, or in Files, as a recording.
public enum RecordingImport {
    /// The toolbar control that picks a file.
    public static let upload = "Upload"
    public static let uploadAudio = "Upload audio files"
    public static let notAudio = "Choose an audio file."
    public static let emptyFile = "This file is empty."

    /// A refusal from a batch of files, named for the file it refused.
    public static func refused(_ fileName: String, _ message: String) -> String {
        "\(fileName): \(message)"
    }

    public static func tooLarge(_ maxFileBytes: Int) -> String {
        "Files are limited to \(RecordingText.bytes(Int64(maxFileBytes)))."
    }

    /// Why a picked file is not added. The server refuses each of these for good, so storing the
    /// file would only leave a recording stuck on an upload that can never succeed.
    struct Refusal: LocalizedError, Equatable {
        let message: String

        var errorDescription: String? { message }
    }

    /// Copies the file at `url` into the user's audio folder and adds it as a recording, named
    /// for the file, filed under `tuneID` or unfiled. Returns the new recording's ID.
    @discardableResult
    public static func add(_ url: URL, to store: CrosstuneStore, tuneID: String?, at time: Timestamp = .now)
        async throws -> String
    {
        // A file from the picker is outside the app's sandbox until access is asked for.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.contentTypeKey, .fileSizeKey])
        guard let type = values.contentType, type.conforms(to: .audio),
            let mime = type.preferredMIMEType, mime.hasPrefix("audio/")
        else { throw Refusal(message: notAudio) }
        let bytes = Int64(values.fileSize ?? 0)
        guard bytes > 0 else { throw Refusal(message: emptyFile) }
        // Read at the moment of the check, so a file picked right after launch is held to the
        // stored limit rather than slipping past one not yet read.
        if let figures = try await store.meta(.storage, as: StorageFigures.self), bytes > Int64(figures.maxFileBytes) {
            throw Refusal(message: tooLarge(figures.maxFileBytes))
        }
        let recordingID = newID()
        let ext = type.preferredFilenameExtension ?? url.pathExtension
        // Never the bare recording ID: an AAC file would then read as a capture to recovery.
        let base = "\(recordingID)-import"
        let fileName = ext.isEmpty ? base : "\(base).\(ext)"
        let destination = store.audioFolder.appending(path: fileName)
        try await copy(url, to: destination)
        let peaksFileName = await writePeaks(recordingID, from: destination, in: store)
        do {
            return try await Commands(store: store).addUploadedFile(
                recordingID, fileName: fileName, contentType: mime, bytes: bytes, tuneID: tuneID,
                label: clippedRecordingLabel(url.deletingPathExtension().lastPathComponent),
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
