#if DEBUG
    import CrosstuneAudio
    import CrosstuneCommands
    import CrosstuneStore
    import Foundation

    /// The catalog the marketing site's captures show, loaded from `site/capture/catalog.json`,
    /// the one fixture every platform reads. Debug builds only.
    ///
    /// The fixture holds rows in the sync wire format, one array per ``SyncTable``, plus a
    /// `files` map from a recording or scan ID to its audio or image, relative to the fixture.
    public enum MarketingCatalog {
        /// The user the marketing store opens for.
        public static let userID = "marketing_user"

        /// The fixed time the rows are written at, so dates read the same on every run.
        public static let now = Timestamp(iso: "2026-09-25T17:00:00.000Z")!

        /// The fixture's only key that is not a table.
        static let filesKey = "files"

        public enum FixtureError: Error, Equatable {
            case notAnObject
            case unknownKey(String)
            case notARow(table: String)
            case missingFile(String)
        }

        /// Opens a store in a fresh temporary folder and writes the whole fixture into it: every
        /// row, each recording's audio as a downloaded file with its waveform, and each scan's
        /// image as a downloaded scan. A load that fails removes `root` with everything copied
        /// into it.
        public static func makeStore(
            fixture: URL,
            root: URL = FileManager.default.temporaryDirectory.appending(
                path: "crosstune-marketing-\(UUID().uuidString)", directoryHint: .isDirectory)
        ) async throws -> CrosstuneStore {
            let object = try JSONDecoder().decode(JSONObject.self, from: Data(contentsOf: fixture))
            let tables = try tableRows(object)
            let files = filePaths(object, relativeTo: fixture.deletingLastPathComponent())
            do {
                return try await load(tables, files: files, root: root)
            } catch {
                try? FileManager.default.removeItem(at: root)
                throw error
            }
        }

        private static func load(_ tables: [SyncTable: [JSONObject]], files: [String: URL], root: URL)
            async throws -> CrosstuneStore
        {
            let store = try CrosstuneStore.open(userID: userID, root: root)
            var settings = try decode(UserSettings.self, tables)
            // Every screen reads the settings row by the ID derived from the signed-in user.
            for index in settings.indices { settings[index].id = settingsID(clerkUserID: userID) }
            let tunes = try decode(Tune.self, tables)
            let userTunes = try decode(UserTune.self, tables)
            let lists = try decode(TuneList.self, tables)
            let listItems = try decode(ListItem.self, tables)
            let links = try decode(RecordingLink.self, tables)
            let recordings = try decode(Recording.self, tables)
            let loops = try decode(RecordingLoop.self, tables)
            var scans = try decode(ScanRecord.self, tables)

            var recordingFiles: [RecordingFile] = []
            for recording in recordings {
                guard let source = files[recording.id] else { continue }
                recordingFiles.append(try await copyAudio(source, for: recording, into: store))
            }
            var scanFiles: [ScanFile] = []
            for index in scans.indices {
                guard let source = files[scans[index].id] else { continue }
                let (file, prepared) = try await writeScan(source, id: scans[index].id, into: store)
                scans[index].width = prepared.width
                scans[index].height = prepared.height
                scanFiles.append(file)
            }

            let loaded = Loaded(
                settings: settings, tunes: tunes, userTunes: userTunes, lists: lists, listItems: listItems,
                links: links, recordings: recordings, loops: loops, scans: scans, recordingFiles: recordingFiles,
                scanFiles: scanFiles)
            try await store.write { writer in try loaded.write(writer) }
            return store
        }

        /// Everything the fixture writes, in the order a row's parent comes before it.
        private struct Loaded: Sendable {
            var settings: [UserSettings]
            var tunes: [Tune]
            var userTunes: [UserTune]
            var lists: [TuneList]
            var listItems: [ListItem]
            var links: [RecordingLink]
            var recordings: [Recording]
            var loops: [RecordingLoop]
            var scans: [ScanRecord]
            var recordingFiles: [RecordingFile]
            var scanFiles: [ScanFile]

            func write(_ writer: StoreWriter) throws {
                for row in settings { try writer.put(row, at: now) }
                for row in tunes { try writer.put(row, at: now) }
                for row in userTunes { try writer.put(row, at: now) }
                for row in lists { try writer.put(row, at: now) }
                for row in listItems { try writer.put(row, at: now) }
                for row in links { try writer.put(row, at: now) }
                for row in recordings { try writer.put(row, at: now) }
                for row in loops { try writer.put(row, at: now) }
                for row in scans { try writer.put(row, at: now) }
                // Local file state is never synced, so it has no outbox entry to queue.
                for file in recordingFiles { try file.upsert(writer.db) }
                for file in scanFiles { try file.upsert(writer.db) }
            }
        }

        private static func tableRows(_ object: JSONObject) throws -> [SyncTable: [JSONObject]] {
            var tables: [SyncTable: [JSONObject]] = [:]
            for (key, value) in object where key != filesKey {
                guard let table = SyncTable(rawValue: key), !table.isEvent else { throw FixtureError.unknownKey(key) }
                guard case .array(let values) = value else { throw FixtureError.notARow(table: key) }
                tables[table] = try values.map {
                    guard case .object(let row) = $0 else { throw FixtureError.notARow(table: key) }
                    return row
                }
            }
            return tables
        }

        private static func filePaths(_ object: JSONObject, relativeTo folder: URL) -> [String: URL] {
            guard case .object(let files) = object[filesKey] ?? .null else { return [:] }
            return files.compactMapValues { value in
                guard case .string(let path) = value else { return nil }
                return folder.appending(path: path)
            }
        }

        /// Decodes a table's rows the way the sync pull does. A fixture row carries only what a
        /// client writes, so the bookkeeping a server row always has is filled in first.
        private static func decode<Record: SyncedRecord>(_: Record.Type, _ tables: [SyncTable: [JSONObject]]) throws
            -> [Record]
        {
            try (tables[Record.table] ?? []).map { row in
                var wire = row
                if wire["updated_at"] == nil { wire["updated_at"] = wire["created_at"] ?? .string(now.iso) }
                if wire["server_seq"] == nil { wire["server_seq"] = .integer(0) }
                return try Record(wire: wire)
            }
        }

        private static func copyAudio(_ source: URL, for recording: Recording, into store: CrosstuneStore)
            async throws -> RecordingFile
        {
            guard FileManager.default.fileExists(atPath: source.path) else {
                throw FixtureError.missingFile(source.path)
            }
            let name = CaptureFiles.finishedName(recording.id)
            let destination = store.audioFolder.appending(path: name)
            try FileManager.default.copyItem(at: source, to: destination)
            let bytes = try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize.map(Int64.init)
            // A recording with no waveform still plays, so a failed decode only leaves it undrawn.
            let peaks = try? await Peaks.read(from: destination)
            let peaksName = try peaks.map { try $0.write(for: recording.id, in: store) }
            return RecordingFile(
                id: recording.id, localState: .downloaded, fileName: name,
                contentType: recording.playbackMime ?? "audio/mp4", bytes: bytes,
                localDurationMs: recording.durationMs, peaksFileName: peaksName, updatedAt: now)
        }

        private static func writeScan(_ source: URL, id: String, into store: CrosstuneStore) async throws -> (
            ScanFile, PreparedScan
        ) {
            guard FileManager.default.fileExists(atPath: source.path) else {
                throw FixtureError.missingFile(source.path)
            }
            let prepared = try await Task.detached { try PreparedScan.make(from: Data(contentsOf: source)) }.value
            // The name a downloaded scan takes, as the server already holds this one.
            let name = "\(id).jpg"
            try prepared.jpeg.write(to: store.scansFolder.appending(path: name), options: .atomic)
            try store.applyBackupRule(toScanFile: name, origin: .downloaded)
            return (ScanFile(scanID: id, fileName: name, origin: .downloaded), prepared)
        }
    }
#endif
