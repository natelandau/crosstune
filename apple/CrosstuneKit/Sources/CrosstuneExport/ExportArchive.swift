import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB

enum ExportArchiveError: LocalizedError, Equatable {
    /// The plan exports a recording with no local file, which `prepare` never produces.
    case noLocalAudio(String)
    /// The plan exports a notation page with no local image, which `prepare` never produces.
    case noLocalNotation(String)

    var errorDescription: String? {
        switch self {
        case .noLocalAudio: "A recording's audio is no longer on this device. Try exporting again."
        case .noLocalNotation: "A notation page's image is no longer on this device. Try exporting again."
        }
    }
}

/// How many recordings this device can export, of every recording not deleted.
public struct ExportCounts: Sendable, Equatable {
    public var onDevice: Int
    public var total: Int

    public init(onDevice: Int, total: Int) {
        self.onDevice = onDevice
        self.total = total
    }
}

/// Packages the data export as a zip in the temporary folder, read only from the local store
/// and the audio this device holds.
public enum ExportArchive {
    public static let workFolderName = "crosstune-export"

    static var defaultRoot: URL {
        FileManager.default.temporaryDirectory.appending(path: workFolderName, directoryHint: .isDirectory)
    }

    /// The counts now, then again after every write that changes them, until the caller stops
    /// listening.
    public static func counts(store: CrosstuneStore) -> AsyncThrowingStream<ExportCounts, any Error> {
        let audioFolder = store.audioFolder
        let values = ValueObservation.tracking { db in try counts(db, audioFolder: audioFolder) }
            .removeDuplicates()
            .values(in: store.database)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await value in values { continuation.yield(value) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The counts as of `db`, matching what ``make(store:now:timeZone:progress:)`` would export.
    /// A download writes its file before its row, so the row's change finds the file in place.
    static func counts(_ db: Database, audioFolder: URL) throws -> ExportCounts {
        let onDevice = Set(
            try RecordingFile.fetchAll(db).filter { file in
                guard file.localState != .capturing, let fileName = file.fileName else { return false }
                return FileManager.default.fileExists(
                    atPath: audioFolder.appending(path: fileName).path(percentEncoded: false))
            }.map(\.id))
        let live = try Recording.fetchAll(db).filter { $0.deletedAt == nil }
        return ExportCounts(onDevice: live.count { onDevice.contains($0.id) }, total: live.count)
    }

    /// Builds the zip and returns where it is. `progress` gets the audio files written so far and
    /// how many there are, starting at zero.
    public static func make(
        store: CrosstuneStore, now: Date, timeZone: TimeZone, progress: @Sendable (Int, Int) -> Void
    ) async throws -> URL {
        try await make(store: store, now: now, timeZone: timeZone, root: defaultRoot, progress: progress)
    }

    /// `beforeWriting` runs once the audio is pinned and before the zip is written, for tests.
    @concurrent
    static func make(
        store: CrosstuneStore, now: Date, timeZone: TimeZone, root: URL, progress: @Sendable (Int, Int) -> Void,
        beforeWriting: @Sendable () throws -> Void = {}
    ) async throws -> URL {
        let job = root.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let pinned = job.appending(path: "audio", directoryHint: .isDirectory)
        let name = "crosstune-export-\(DateText(timeZone: timeZone)(now))"
        let zip = job.appending(path: "\(name).zip")
        do {
            try FileManager.default.createDirectory(at: pinned, withIntermediateDirectories: true)
            let (plan, sources, notationSources) = try await prepare(
                store: store, timeZone: timeZone, pinningInto: pinned)
            let documents = [
                ZipEntry(path: "tunes.csv", source: .data(Data(plan.tunesCSV.utf8))),
                ZipEntry(path: "lists.csv", source: .data(Data(plan.listsCSV.utf8))),
            ]
            let audio = try plan.audio.map { item in
                guard let source = sources[item.recordingID] else {
                    throw ExportArchiveError.noLocalAudio(item.recordingID)
                }
                return ZipEntry(path: item.path, source: .file(source))
            }
            let notation = try plan.notation.map { item in
                guard let source = notationSources[item.pageID] else {
                    throw ExportArchiveError.noLocalNotation(item.pageID)
                }
                return ZipEntry(path: item.path, source: .file(source))
            }
            try beforeWriting()

            let files = audio + notation
            progress(0, files.count)
            try writeStoredZip(documents + files, to: zip, modified: now, timeZone: timeZone) { written in
                if written > documents.count { progress(written - documents.count, files.count) }
            }
            // The zip is complete, so a pin that will not go is left for removeLeftovers.
            try? FileManager.default.removeItem(at: pinned)
            return zip
        } catch {
            try? FileManager.default.removeItem(at: job)
            throw error
        }
    }

    /// Deletes every export a past run left in the temporary folder.
    public static func removeLeftovers() {
        removeLeftovers(root: defaultRoot)
    }

    static func removeLeftovers(root: URL) {
        try? FileManager.default.removeItem(at: root)
    }

    /// The export plan, and a pinned copy of the audio file for each recording it exports and of
    /// the image file for each notation page.
    ///
    /// A sync can delete or replace a recording's file at any moment, so each one is hard-linked
    /// (or, failing that, cloned) into `folder` before the plan counts it. The zip then reads
    /// files no sync touches, and a file already gone counts as not on this device.
    private static func prepare(store: CrosstuneStore, timeZone: TimeZone, pinningInto folder: URL) async throws -> (
        ExportPlan, [String: URL], [String: URL]
    ) {
        let settingsRow = settingsID(clerkUserID: store.userID)
        let (input, files, pageFiles) = try await store.read { db in
            let settings = try UserSettings.fetchOne(db, key: settingsRow).flatMap { $0.deletedAt == nil ? $0 : nil }
            let input = ExportInput(
                timeZone: timeZone, instruments: settings?.instruments ?? [], tunes: try Tune.fetchAll(db),
                userTunes: try UserTune.fetchAll(db), lists: try TuneList.fetchAll(db),
                listItems: try ListItem.fetchAll(db), links: try RecordingLink.fetchAll(db),
                recordings: try Recording.fetchAll(db), localAudio: [],
                notationPages: try NotationPageRecord.fetchAll(db))
            return (input, try RecordingFile.fetchAll(db), try NotationFile.fetchAll(db))
        }

        var sources: [String: URL] = [:]
        var localAudio: [LocalAudio] = []
        // Only a live recording is exported, so no other file is worth a pin or a clone.
        let live = Set(input.recordings.filter { $0.deletedAt == nil }.map(\.id))
        for file in files where file.localState != .capturing && live.contains(file.id) {
            guard let fileName = file.fileName else { continue }
            let pinned = folder.appending(path: fileName)
            guard try pin(store.audioFolder.appending(path: fileName), at: pinned) else { continue }
            sources[file.id] = pinned
            localAudio.append(LocalAudio(recordingID: file.id, fileName: fileName))
        }

        var notationSources: [String: URL] = [:]
        let livePages = Set(input.notationPages.filter { $0.deletedAt == nil }.map(\.id))
        for file in pageFiles where livePages.contains(file.pageID) {
            // The prefix keeps a page's pin from sharing a name with an audio pin.
            let pinned = folder.appending(path: "notation-\(file.fileName)")
            guard try pin(store.notationFolder.appending(path: file.fileName), at: pinned) else { continue }
            notationSources[file.pageID] = pinned
        }

        var complete = input
        complete.localAudio = localAudio
        complete.localNotation = Set(notationSources.keys)
        return (buildExport(complete), sources, notationSources)
    }

    /// Links `source` at `destination`, or clones it where a link cannot be made. Returns false
    /// when `source` does not exist.
    private static func pin(_ source: URL, at destination: URL) throws -> Bool {
        let files = FileManager.default
        func gone() -> Bool { !files.fileExists(atPath: source.path(percentEncoded: false)) }
        do {
            try files.linkItem(at: source, to: destination)
            return true
        } catch {
            if gone() { return false }
        }
        do {
            try files.copyItem(at: source, to: destination)
            return true
        } catch {
            if gone() { return false }
            throw error
        }
    }
}
