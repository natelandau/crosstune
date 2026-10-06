import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

private let captureFolder = URL(filePath: #filePath)
    .deletingLastPathComponent()
    .appending(path: "../../../../site/capture", directoryHint: .isDirectory)
    .standardizedFileURL
private let fixture = captureFolder.appending(path: "catalog.json")

/// The fixture's raw JSON, read apart from the loader so a test checks the loader against it.
private func fixtureObject() throws -> JSONObject {
    try JSONDecoder().decode(JSONObject.self, from: Data(contentsOf: fixture))
}

private func rows(_ table: SyncTable, in object: JSONObject) -> [JSONObject] {
    guard case .array(let values) = object[table.rawValue] ?? .null else { return [] }
    return values.compactMap { if case .object(let row) = $0 { row } else { nil } }
}

private func count(_ table: SyncTable, in store: CrosstuneStore) async throws -> Int {
    try await store.read { db in
        try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table.rawValue)") ?? 0
    }
}

@Suite struct MarketingCatalogTests {
    @Test func opensEveryRow() async throws {
        let root = TemporaryRoot()
        let store = try await MarketingCatalog.makeStore(fixture: fixture, root: root.url)
        let object = try fixtureObject()
        for table in SyncTable.allCases where !table.isEvent {
            #expect(try await count(table, in: store) == rows(table, in: object).count, "\(table.rawValue)")
        }
    }

    @Test func keepsAFileForEveryRecordingAndScanWithOne() async throws {
        let root = TemporaryRoot()
        let store = try await MarketingCatalog.makeStore(fixture: fixture, root: root.url)
        let object = try fixtureObject()
        guard case .object(let files) = object["files"] ?? .null else {
            Issue.record("the fixture has no files map")
            return
        }
        let ids = { (table: SyncTable) in
            rows(table, in: object).compactMap { row -> String? in
                if case .string(let id) = row["id"] ?? .null, files[id] != nil { id } else { nil }
            }
        }
        let (recordingFiles, scanFiles) = try await store.read { db in
            (try RecordingFile.fetchAll(db), try ScanFile.fetchAll(db))
        }
        #expect(Set(recordingFiles.map(\.id)) == Set(ids(.recordings)))
        #expect(Set(scanFiles.map(\.scanID)) == Set(ids(.scans)))
        #expect(recordingFiles.count == ids(.recordings).count)
        #expect(scanFiles.count == ids(.scans).count)
    }

    @Test func rekeysTheSettingsToTheSignedInUser() async throws {
        let root = TemporaryRoot()
        let store = try await MarketingCatalog.makeStore(fixture: fixture, root: root.url)
        let settings = try await store.read { try UserSettings.fetchAll($0) }
        #expect(settings.map(\.id) == [settingsID(clerkUserID: MarketingCatalog.userID)])
    }

    @Test func removesItsFolderWhenLoadingFails() async throws {
        let source = TemporaryRoot()
        let assets = source.url.appending(path: "assets", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)
        let object = try fixtureObject()
        guard case .object(let files) = object["files"] ?? .null else {
            Issue.record("the fixture has no files map")
            return
        }
        // Every audio file is there, but no scan image, so the load fails after copying audio.
        for case .string(let path) in files.values where path.hasSuffix(".m4a") {
            let target = source.url.appending(path: path)
            if !FileManager.default.fileExists(atPath: target.path) {
                try FileManager.default.copyItem(at: captureFolder.appending(path: path), to: target)
            }
        }
        let copied = source.url.appending(path: "catalog.json")
        try FileManager.default.copyItem(at: fixture, to: copied)
        let root = TemporaryRoot()

        await #expect(throws: MarketingCatalog.FixtureError.self) {
            _ = try await MarketingCatalog.makeStore(fixture: copied, root: root.url)
        }
        #expect(!FileManager.default.fileExists(atPath: root.url.path))
    }

    @Test func holdsTheNamedTunes() async throws {
        let root = TemporaryRoot()
        let store = try await MarketingCatalog.makeStore(fixture: fixture, root: root.url)
        let tunes = try await store.read { try Tune.fetchAll($0) }
        let titles = Set(tunes.map(\.title))
        #expect(titles.isSuperset(of: ["Backstep Cindy", "Half Past Four", "Bibb County Hoedown"]))
        let halfPastFour = try #require(tunes.first { $0.title == "Half Past Four" })
        #expect(halfPastFour.tunings["violin"] == .object(["tuning": .string("Cross A (AEAE)")]))
        let userTunes = try await store.read { try UserTune.fetchAll($0) }
        #expect(userTunes.contains { $0.learnedFrom == "Joe at Clifftop" })
        #expect(Set(userTunes.map(\.status)) == ["known", "learning", "want_to_learn"])
    }

    @Test func hasNoPlaceholders() throws {
        let titles = rows(.tunes, in: try fixtureObject()).compactMap { row -> String? in
            if case .string(let title) = row["title"] ?? .null { title } else { nil }
        }
        #expect(!titles.isEmpty)
        #expect(!titles.contains { $0.localizedCaseInsensitiveContains("no key yet") })
    }

    @Test func hasPlayableAudio() async throws {
        let root = TemporaryRoot()
        let store = try await MarketingCatalog.makeStore(fixture: fixture, root: root.url)
        let recording = try await expectDownloadedRecording(of: "Bibb County Hoedown", in: store)
        let loops = try await store.read { db in
            try RecordingLoop.filter(RecordingLoop.CodingKeys.recordingID == recording.id).fetchAll(db)
        }
        #expect(Set(loops.compactMap(\.label)) == ["A part", "Turnaround"])
    }

    @Test func jamTuneIsInDWithLocalAudio() async throws {
        let root = TemporaryRoot()
        let store = try await MarketingCatalog.makeStore(fixture: fixture, root: root.url)
        let tunes = try await store.read { try Tune.fetchAll($0) }
        #expect(tunes.first { $0.title == "Backstep Cindy" }?.key == "D")
        #expect(tunes.count { $0.key == "D" } >= 4)
        try await expectDownloadedRecording(of: "Backstep Cindy", in: store)
    }

    /// The tune's recording, after checking it is ready and its audio is on disk.
    @discardableResult
    private func expectDownloadedRecording(of title: String, in store: CrosstuneStore) async throws -> Recording {
        let (recording, file) = try await store.read { db -> (Recording?, RecordingFile?) in
            let tune = try Tune.filter(Tune.CodingKeys.title == title).fetchOne(db)
            let recording = try Recording.filter(Recording.CodingKeys.tuneID == tune?.id).fetchOne(db)
            return (recording, try recording.flatMap { try RecordingFile.fetchOne(db, key: $0.id) })
        }
        let ready = try #require(recording, "\(title) has no recording")
        #expect(ready.state == "ready")
        let local = try #require(file, "\(title) has no local file")
        #expect(local.localState == .downloaded)
        let name = try #require(local.fileName)
        #expect(FileManager.default.fileExists(atPath: store.audioFolder.appending(path: name).path))
        return ready
    }

    @Test func everyFileExists() throws {
        guard case .object(let files) = try fixtureObject()["files"] ?? .null else {
            Issue.record("the fixture has no files map")
            return
        }
        #expect(!files.isEmpty)
        for (id, value) in files {
            guard case .string(let path) = value else {
                Issue.record("\(id) has no path")
                continue
            }
            let url = captureFolder.appending(path: path).standardizedFileURL
            #expect(url.path.hasPrefix(captureFolder.path), "\(path)")
            #expect(FileManager.default.fileExists(atPath: url.path), "\(path)")
        }
    }
}
