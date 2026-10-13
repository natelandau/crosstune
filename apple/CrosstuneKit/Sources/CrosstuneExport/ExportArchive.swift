import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB

enum ExportArchiveError: LocalizedError, Equatable {
    /// The plan exports a recording with no local file to fetch, which `prepare` never produces.
    case noLocalAudio(String)
    /// The plan exports a scan with no local image to fetch, which `prepare` never produces.
    case noLocalScans(String)

    var errorDescription: String? {
        switch self {
        case .noLocalAudio: "Couldn't find a recording's audio to export. Try exporting again."
        case .noLocalScans: "Couldn't find a scan's image to export. Try exporting again."
        }
    }
}

/// The export's recordings and scans: those whose file this device holds, all of them, and
/// those an export fetches from the server. A file not yet ready on the server is neither held
/// nor fetched, so it counts toward `total` alone.
public struct ExportCounts: Sendable, Equatable {
    public var onDevice: Int
    public var total: Int
    public var missing: Int

    public init(onDevice: Int, total: Int, missing: Int = 0) {
        self.onDevice = onDevice
        self.total = total
        self.missing = missing
    }
}

/// A file the export holds that this device does not.
public enum ExportFile: Sendable, Hashable {
    case recording(String)
    case scan(String)
}

/// Fetches one file the device does not hold into `destination`, inside the export's own
/// temporary folder.
public typealias FetchMissing = @Sendable (_ file: ExportFile, _ destination: URL) async throws -> Void

/// Packages the data export as a zip in the temporary folder, read from the local store and the
/// files this device holds, with every other ready recording and scan fetched alongside them.
/// A fetched file lives only in the export's temporary folder, never in the store's.
public enum ExportArchive {
    public static let workFolderName = "crosstune-export"

    static var defaultRoot: URL {
        FileManager.default.temporaryDirectory.appending(path: workFolderName, directoryHint: .isDirectory)
    }

    /// The counts now, then again after every write that changes them, until the caller stops
    /// listening.
    public static func counts(store: CrosstuneStore) -> AsyncThrowingStream<ExportCounts, any Error> {
        let (audioFolder, scansFolder) = (store.audioFolder, store.scansFolder)
        let values = ValueObservation.tracking { db in
            try counts(db, audioFolder: audioFolder, scansFolder: scansFolder)
        }
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

    /// The counts as of `db`, matching what ``make(store:now:timeZone:fetchMissing:progress:)``
    /// would export: every live recording, filed or not, and the scans of exported tunes, which
    /// have a live user-tune. A download writes its file before its row, so the row's change
    /// finds the file in place.
    static func counts(_ db: Database, audioFolder: URL, scansFolder: URL) throws -> ExportCounts {
        let audioNames = CrosstuneStore.fileNames(in: audioFolder)
        let scanNames = CrosstuneStore.fileNames(in: scansFolder)
        func held(_ fileName: String?, in names: Set<String>) -> Bool {
            fileName.map(names.contains) ?? false
        }
        let recordings = try Row.fetchAll(
            db,
            sql: """
                SELECT r.state, CASE WHEN f.local_state <> ? THEN f.file_name END AS file_name
                FROM recordings r LEFT JOIN recording_files f ON f.id = r.id
                WHERE r.deleted_at IS NULL
                """,
            arguments: [LocalFileState.capturing]
        ).map { row in (ready: row["state"] as String? == "ready", held: held(row["file_name"], in: audioNames)) }
        let scans = try Row.fetchAll(
            db,
            sql: """
                SELECT s.state, f.file_name FROM scans s LEFT JOIN scan_files f ON f.scan_id = s.id
                WHERE s.id IN (\(ScanRecord.liveIDsSQL))
                AND EXISTS (SELECT 1 FROM user_tunes u WHERE u.tune_id = s.tune_id AND u.deleted_at IS NULL)
                """
        ).map { row in
            (ready: row["state"] as String? == ScanRecord.ready, held: held(row["file_name"], in: scanNames))
        }
        let files = recordings + scans
        return ExportCounts(
            onDevice: files.count(where: \.held), total: files.count,
            missing: files.count { $0.ready && !$0.held })
    }

    /// Builds the zip and returns where it is. `fetchMissing` fetches each ready file this device
    /// does not hold, and any one failing fails the export. `progress` gets the steps done so
    /// far, each fetch and then each file written, and how many there are, starting at zero.
    public static func make(
        store: CrosstuneStore, now: Date, timeZone: TimeZone, fetchMissing: @escaping FetchMissing,
        progress: @Sendable (Int, Int) -> Void
    ) async throws -> URL {
        try await make(
            store: store, now: now, timeZone: timeZone, root: defaultRoot, fetchMissing: fetchMissing,
            progress: progress)
    }

    /// `beforeWriting` runs once the files are pinned and fetched and before the zip is written,
    /// for tests.
    @concurrent
    static func make(
        store: CrosstuneStore, now: Date, timeZone: TimeZone, root: URL,
        fetchMissing: @escaping FetchMissing = { _, _ in throw URLError(.notConnectedToInternet) },
        progress: @Sendable (Int, Int) -> Void, beforeWriting: @Sendable () throws -> Void = {}
    ) async throws -> URL {
        let job = root.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let pinned = job.appending(path: "audio", directoryHint: .isDirectory)
        let name = "crosstune-export-\(DateText(timeZone: timeZone)(now))"
        let zip = job.appending(path: "\(name).zip")
        do {
            try FileManager.default.createDirectory(at: pinned, withIntermediateDirectories: true)
            let (plan, sources, scanSources, fetchable) = try await prepare(
                store: store, timeZone: timeZone, pinningInto: pinned)
            // Fetched files share the pinned folder, so every way out below removes them.
            var fetches: [(file: ExportFile, destination: URL)] = []
            func fetched(_ file: ExportFile) -> URL? {
                guard fetchable.contains(file) else { return nil }
                let destination = pinned.appending(path: "fetched-\(UUID().uuidString)")
                fetches.append((file, destination))
                return destination
            }
            let documents = [
                ZipEntry(path: "tunes.csv", source: .data(Data(plan.tunesCSV.utf8))),
                ZipEntry(path: "lists.csv", source: .data(Data(plan.listsCSV.utf8))),
            ]
            let audio = try plan.audio.map { item in
                guard let source = sources[item.recordingID] ?? fetched(.recording(item.recordingID)) else {
                    throw ExportArchiveError.noLocalAudio(item.recordingID)
                }
                return ZipEntry(path: item.path, source: .file(source))
            }
            let scans = try plan.scans.map { item in
                guard let source = scanSources[item.scanID] ?? fetched(.scan(item.scanID)) else {
                    throw ExportArchiveError.noLocalScans(item.scanID)
                }
                return ZipEntry(path: item.path, source: .file(source))
            }
            let files = audio + scans
            let steps = fetches.count + files.count
            progress(0, steps)
            try await fetchAll(fetches, with: fetchMissing) { progress($0, steps) }
            try Task.checkCancellation()
            try beforeWriting()

            try writeStoredZip(documents + files, to: zip, modified: now, timeZone: timeZone) { written in
                if written > documents.count { progress(fetches.count + written - documents.count, steps) }
            }
            // The zip is complete, so a pin that will not go is left for removeLeftovers.
            try? FileManager.default.removeItem(at: pinned)
            return zip
        } catch {
            try? FileManager.default.removeItem(at: job)
            throw error
        }
    }

    /// How many missing files an export fetches at once.
    static let fetchConcurrency = 3

    /// Runs every fetch, at most ``fetchConcurrency`` at a time, and reports each one done. The
    /// first failure cancels the fetches still under way and is thrown once they have stopped.
    private static func fetchAll(
        _ fetches: [(file: ExportFile, destination: URL)], with fetchMissing: @escaping FetchMissing,
        done: (Int) -> Void
    ) async throws {
        try await withThrowingTaskGroup(of: Void.self) { group in
            var finished = 0
            var running = 0
            do {
                for fetch in fetches {
                    if running == fetchConcurrency {
                        try await group.next()
                        running -= 1
                        finished += 1
                        done(finished)
                    }
                    try Task.checkCancellation()
                    group.addTask { try await fetchMissing(fetch.file, fetch.destination) }
                    running += 1
                }
                while try await group.next() != nil {
                    finished += 1
                    done(finished)
                }
            } catch {
                group.cancelAll()
                throw error
            }
        }
    }

    /// Deletes every export a past run left in the temporary folder.
    public static func removeLeftovers() {
        removeLeftovers(root: defaultRoot)
    }

    static func removeLeftovers(root: URL) {
        try? FileManager.default.removeItem(at: root)
    }

    /// The export plan, a pinned copy of the audio file for each recording it exports and of the
    /// image file for each scan, and the ready files to fetch because no copy is here.
    ///
    /// A sync can delete or replace a recording's file at any moment, so each one is hard-linked
    /// (or, failing that, cloned) into `folder` before the plan counts it. The zip then reads
    /// files no sync touches, and a file already gone counts as not on this device.
    private static func prepare(store: CrosstuneStore, timeZone: TimeZone, pinningInto folder: URL) async throws -> (
        ExportPlan, [String: URL], [String: URL], Set<ExportFile>
    ) {
        let settingsRow = settingsID(clerkUserID: store.userID)
        let (input, files, scanFiles) = try await store.read { db in
            let settings = try UserSettings.fetchOne(db, key: settingsRow).flatMap { $0.deletedAt == nil ? $0 : nil }
            let input = ExportInput(
                timeZone: timeZone, instruments: settings?.instruments ?? [], tunes: try Tune.fetchAll(db),
                userTunes: try UserTune.fetchAll(db), lists: try TuneList.fetchAll(db),
                listItems: try ListItem.fetchAll(db), links: try RecordingLink.fetchAll(db),
                recordings: try Recording.fetchAll(db), localAudio: [],
                scans: try ScanRecord.fetchAll(db))
            return (input, try RecordingFile.fetchAll(db), try ScanFile.fetchAll(db))
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

        var scanSources: [String: URL] = [:]
        let liveScans = Set(input.scans.filter { $0.deletedAt == nil }.map(\.id))
        for file in scanFiles where liveScans.contains(file.scanID) {
            // The prefix keeps a scan's pin from sharing a name with an audio pin.
            let pinned = folder.appending(path: "scan-\(file.fileName)")
            guard try pin(store.scansFolder.appending(path: file.fileName), at: pinned) else { continue }
            scanSources[file.scanID] = pinned
        }

        var fetchable = Set<ExportFile>()
        for recording in input.recordings
        where recording.deletedAt == nil && recording.state == "ready" && sources[recording.id] == nil {
            fetchable.insert(.recording(recording.id))
            localAudio.append(
                LocalAudio(recordingID: recording.id, fileExtension: playbackFileExtension(recording.playbackMime)))
        }
        var localScans = Set(scanSources.keys)
        for scan in input.scans
        where scan.deletedAt == nil && scan.state == ScanRecord.ready && scanSources[scan.id] == nil {
            fetchable.insert(.scan(scan.id))
            localScans.insert(scan.id)
        }

        var complete = input
        complete.localAudio = localAudio
        complete.localScans = localScans
        return (buildExport(complete), sources, scanSources, fetchable)
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
