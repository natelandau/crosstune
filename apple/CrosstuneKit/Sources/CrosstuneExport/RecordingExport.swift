import Foundation

/// One recording to export: how to name and tag it, and where its audio comes from.
public struct RecordingExportItem: Sendable {
    public var recordingID: String
    public var name: NameInput
    /// The tune's title, for the album tag.
    public var album: String?
    public var readiness: ExportReadiness

    public init(recordingID: String, name: NameInput, album: String?, readiness: ExportReadiness) {
        self.recordingID = recordingID
        self.name = name
        self.album = album
        self.readiness = readiness
    }
}

/// Fetches one recording the device does not hold into `destination`, inside the job's own
/// folder, without storing it.
public typealias FetchRecording = @Sendable (_ recordingID: String, _ destination: URL) async throws -> Void

/// The job folder and the files in it, in the order of the items that produced them.
public struct RecordingExportResult: Sendable {
    public var folder: URL
    public var files: [URL]
    public var fetched: Int
    /// Items that could not be exported when the job started.
    public var blocked: Int
    /// Items whose audio could not be fetched or found.
    public var failed: Int

    public init(folder: URL, files: [URL], fetched: Int, blocked: Int, failed: Int) {
        self.folder = folder
        self.files = files
        self.fetched = fetched
        self.blocked = blocked
        self.failed = failed
    }

    /// Every item left out, for whatever reason.
    public var skipped: Int { blocked + failed }
}

/// Gathers recordings into a temporary job folder, each named for export and tagged where its
/// format allows, for the platform to share or save. The stored files never change.
public enum RecordingExport {
    static var defaultRoot: URL { ExportWorkFolder.recordings.url }

    /// Prepares every item that is not blocked, one at a time. A failed fetch skips that item.
    /// `progress` gets the items done so far and how many are not blocked, starting at zero.
    /// Cancelling the task removes the job folder.
    public static func prepare(
        _ items: [RecordingExportItem], timeZone: TimeZone, fetch: @escaping FetchRecording,
        progress: @Sendable (Int, Int) -> Void
    ) async throws -> RecordingExportResult {
        try await prepare(items, timeZone: timeZone, root: defaultRoot, fetch: fetch, progress: progress)
    }

    @concurrent
    static func prepare(
        _ items: [RecordingExportItem], timeZone: TimeZone, root: URL, fetch: @escaping FetchRecording,
        progress: @Sendable (Int, Int) -> Void
    ) async throws -> RecordingExportResult {
        let job = root.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let sources = job.appending(path: "source", directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: sources, withIntermediateDirectories: true)
            let exportable = items.filter { !$0.readiness.isBlocked }
            let inputs = exportable.map(nameInput)
            // Named before fetching, so a failed fetch can leave a gap in the ` (2)`, ` (3)` run.
            let names = fileNames(inputs, timeZone: timeZone)
            let local = DateText(timeZone: timeZone)
            var result = RecordingExportResult(
                folder: job, files: [], fetched: 0, blocked: items.count - exportable.count, failed: 0)
            progress(0, exportable.count)
            for index in exportable.indices {
                try Task.checkCancellation()
                let item = exportable[index]
                let destination = job.appending(path: names[index])
                if try await export(
                    item, as: inputs[index], to: destination, sources: sources, local: local, fetch: fetch)
                {
                    result.files.append(destination)
                    if case .fetch = item.readiness { result.fetched += 1 }
                } else {
                    result.failed += 1
                }
                progress(index + 1, exportable.count)
            }
            try Task.checkCancellation()
            // Every file is in place, so a source that will not go is left for removeLeftovers.
            try? FileManager.default.removeItem(at: sources)
            return result
        } catch {
            try? FileManager.default.removeItem(at: job)
            throw error
        }
    }

    /// The local file's own extension wins over the one the caller expects, so a capture not yet
    /// transcoded keeps the extension that matches its bytes.
    private static func nameInput(_ item: RecordingExportItem) -> NameInput {
        guard case .local(let file) = item.readiness, !file.pathExtension.isEmpty else { return item.name }
        var name = item.name
        name.fileExtension = file.pathExtension
        return name
    }

    /// Puts one item's audio at `destination`, tagged when the tags can be written and untagged
    /// otherwise. Returns false when the audio could not be had. Throws only for cancellation or a
    /// file that cannot be copied within the job folder.
    private static func export(
        _ item: RecordingExportItem, as name: NameInput, to destination: URL, sources: URL, local: DateText,
        fetch: FetchRecording
    ) async throws -> Bool {
        // The tag writer reads the format from the extension, so the source carries the name's.
        let source = sources.appending(path: "\(UUID().uuidString).\(name.fileExtension)")
        defer { try? FileManager.default.removeItem(at: source) }
        do {
            switch item.readiness {
            case .local(let file):
                // A link, so a sync that deletes or replaces the stored file cannot change this one.
                guard try ExportArchive.pin(file, at: source) else { return false }
            case .fetch:
                try await fetch(item.recordingID, source)
            case .blocked:
                return false
            }
        } catch {
            try Task.checkCancellation()
            return false
        }
        let tags = AudioTagValues(
            title: name.title, album: item.album, date: name.recordedDateText(local: local))
        do {
            try await AudioTags.write(from: source, to: destination, tags: tags)
        } catch {
            try Task.checkCancellation()
            // A copy, not a move: the source may be a hard link to the stored file, and a link
            // handed out would let another app change the stored audio. APFS makes this a clone.
            try FileManager.default.copyItem(at: source, to: destination)
        }
        return true
    }

    /// Copies prepared `files` into `folder`, each under its own name. A name the folder already
    /// holds, in any case, gets ` (2)`, ` (3)`, and the file there is left as it was. Returns where
    /// each file went, in order. A failure removes the copies it made before it throws.
    public static func writeIntoFolder(_ files: [URL], folder: URL) throws -> [URL] {
        let manager = FileManager.default
        var allocator = NameAllocator(
            reserving: try manager.contentsOfDirectory(atPath: folder.path(percentEncoded: false)))
        var written: [URL] = []
        do {
            for file in files {
                let stem = file.deletingPathExtension().lastPathComponent
                while true {
                    let destination = folder.appending(path: allocator.take(safe: stem, ext: file.pathExtension))
                    do {
                        try manager.copyItem(at: file, to: destination)
                        written.append(destination)
                        break
                    } catch let error as CocoaError where error.code == .fileWriteFileExists {
                        // Another app took the name after the folder was read: try the next one.
                        continue
                    }
                }
            }
        } catch {
            for url in written { try? manager.removeItem(at: url) }
            throw error
        }
        return written
    }

    /// Deletes the job folder once the platform is done with its files.
    public static func discard(_ result: RecordingExportResult) {
        try? FileManager.default.removeItem(at: result.folder)
    }
}
