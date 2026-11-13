import AVFoundation
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneExport

private let utc = TimeZone(identifier: "UTC")!
private let recorded = Date(timeIntervalSince1970: 1_794_484_800)  // 2026-11-12T12:00:00Z
private let webmBytes = Data("not really webm".utf8)

private func workFolder() -> URL {
    FileManager.default.temporaryDirectory
        .appending(path: "crosstune-recording-export-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
}

private func contents(_ folder: URL) -> [String] {
    (try? FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false))) ?? []
}

private func name(_ title: String, ext: String = "m4a") -> NameInput {
    NameInput(title: title, titleIsDate: false, recordedAt: nil, precision: nil, fileExtension: ext)
}

private func item(_ title: String, _ readiness: ExportReadiness, ext: String = "m4a", album: String? = nil)
    -> RecordingExportItem
{
    RecordingExportItem(recordingID: UUID().uuidString, name: name(title, ext: ext), album: album, readiness: readiness)
}

private func localWebm(in folder: URL) throws -> URL {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appending(path: "\(UUID().uuidString).webm")
    try webmBytes.write(to: url)
    return url
}

private struct FetchRefused: Error {}

private final class Calls: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [[Int]] = []
    func append(_ done: Int, _ total: Int) { lock.withLock { calls.append([done, total]) } }
    var all: [[Int]] { lock.withLock { calls } }
}

private final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func set() { lock.withLock { value = true } }
    var isSet: Bool { lock.withLock { value } }
}

@Suite struct RecordingExportTests {
    @Test func blockedItemsAreSkippedAndNamesNumberOnlyTheExportedOnes() async throws {
        let work = workFolder()
        let held = workFolder()
        defer {
            try? FileManager.default.removeItem(at: work)
            try? FileManager.default.removeItem(at: held)
        }
        let calls = Calls()
        let items = [
            item("Reel", .local(try localWebm(in: held))),
            item("Reel", .blocked(.capturing)),
            item("Reel", .local(try localWebm(in: held))),
        ]

        let result = try await RecordingExport.prepare(
            items, timeZone: utc, root: work, fetch: { _, _ in Issue.record("Nothing to fetch") },
            progress: calls.append)

        #expect(result.files.map(\.lastPathComponent) == ["Reel.webm", "Reel (2).webm"])
        #expect(result.blocked == 1)
        #expect(result.failed == 0)
        #expect(result.fetched == 0)
        #expect(calls.all == [[0, 2], [1, 2], [2, 2]])
        #expect(contents(result.folder).sorted() == ["Reel (2).webm", "Reel.webm"])

        RecordingExport.discard(result)
        #expect(contents(work).isEmpty)
    }

    @Test func aFailedFetchIsSkippedAndTheRestFinish() async throws {
        let work = workFolder()
        defer { try? FileManager.default.removeItem(at: work) }
        let failing = item("Jig", .fetch)
        let working = item("Hornpipe", .fetch, ext: "webm")

        let result = try await RecordingExport.prepare(
            [failing, working], timeZone: utc, root: work,
            fetch: { id, destination in
                guard id == working.recordingID else { throw FetchRefused() }
                try webmBytes.write(to: destination)
            },
            progress: { _, _ in })

        #expect(result.files.map(\.lastPathComponent) == ["Hornpipe.webm"])
        #expect(try Data(contentsOf: result.files[0]) == webmBytes)
        #expect(result.fetched == 1)
        #expect(result.failed == 1)
        #expect(contents(result.folder) == ["Hornpipe.webm"])
    }

    /// A `.webm` capture cannot be tagged, and neither can an `.m4a` the tag writer cannot read.
    @Test(arguments: [("webm", "Slip Jig.webm"), ("m4a", "Slip Jig.m4a")])
    func aFileThatCannotBeTaggedIsExportedUntaggedAsACopy(ext: String, expected: String) async throws {
        let work = workFolder()
        let held = workFolder()
        defer {
            try? FileManager.default.removeItem(at: work)
            try? FileManager.default.removeItem(at: held)
        }
        try FileManager.default.createDirectory(at: held, withIntermediateDirectories: true)
        let source = held.appending(path: "stored.\(ext)")
        try webmBytes.write(to: source)

        let result = try await RecordingExport.prepare(
            [item("Slip Jig", .local(source), ext: "m4a")], timeZone: utc, root: work,
            fetch: { _, _ in }, progress: { _, _ in })

        #expect(result.files.map(\.lastPathComponent) == [expected])
        #expect(try Data(contentsOf: result.files[0]) == webmBytes)
        #expect(try Data(contentsOf: source) == webmBytes)
        func inode(_ url: URL) throws -> Int? {
            try FileManager.default.attributesOfItem(atPath: url.path(percentEncoded: false))[.systemFileNumber]
                as? Int
        }
        #expect(try inode(result.files[0]) != inode(source))
    }

    @Test func aLocalFileThatIsGoneIsSkippedAndTheRestFinish() async throws {
        let work = workFolder()
        let held = workFolder()
        defer {
            try? FileManager.default.removeItem(at: work)
            try? FileManager.default.removeItem(at: held)
        }
        let gone = held.appending(path: "gone.webm")

        let result = try await RecordingExport.prepare(
            [item("Gone", .local(gone)), item("Kept", .local(try localWebm(in: held)))], timeZone: utc, root: work,
            fetch: { _, _ in }, progress: { _, _ in })

        #expect(result.files.map(\.lastPathComponent) == ["Kept.webm"])
        #expect(result.failed == 1)
        #expect(contents(result.folder) == ["Kept.webm"])
    }

    @Test(.timeLimit(.minutes(1))) func anM4AFileIsTaggedWithTheTitleAlbumAndTheDateOfItsName() async throws {
        let work = workFolder()
        let held = workFolder()
        defer {
            try? FileManager.default.removeItem(at: work)
            try? FileManager.default.removeItem(at: held)
        }
        try FileManager.default.createDirectory(at: held, withIntermediateDirectories: true)
        let source = held.appending(path: "stored.m4a")
        try writeTone(to: source, seconds: 0.5)
        let before = try Data(contentsOf: source)
        let input = RecordingExportItem(
            recordingID: "r1",
            name: NameInput(
                title: "Morning", titleIsDate: false, recordedAt: recorded, precision: .day, fileExtension: "m4a"),
            album: "The Silver Spear", readiness: .local(source))

        let result = try await RecordingExport.prepare(
            [input], timeZone: utc, root: work, fetch: { _, _ in }, progress: { _, _ in })

        #expect(result.files.map(\.lastPathComponent) == ["Morning 2026-11-12.m4a"])
        let metadata = try await AVURLAsset(url: result.files[0]).load(.metadata)
        func string(_ id: AVMetadataIdentifier) async throws -> String? {
            let items = AVMetadataItem.metadataItems(from: metadata, filteredByIdentifier: id)
            return try await items.first?.load(.stringValue)
        }
        #expect(try await string(.iTunesMetadataSongName) == "Morning")
        #expect(try await string(.iTunesMetadataAlbum) == "The Silver Spear")
        #expect(try await string(.iTunesMetadataReleaseDate) == "2026-11-12")
        #expect(try Data(contentsOf: source) == before)
        #expect(contents(result.folder) == ["Morning 2026-11-12.m4a"])
    }

    @Test(.timeLimit(.minutes(1))) func cancellingDuringAFetchLeavesNothing() async throws {
        let work = workFolder()
        defer { try? FileManager.default.removeItem(at: work) }
        let fetching = Flag()
        let task = Task {
            try await RecordingExport.prepare(
                [item("Reel", .fetch), item("Jig", .fetch)], timeZone: utc, root: work,
                fetch: { _, destination in
                    try webmBytes.write(to: destination)
                    fetching.set()
                    // Ends only by cancellation, which the poll's sleep throws.
                    _ = try await poll { false }
                },
                progress: { _, _ in })
        }
        try await eventually { fetching.isSet }

        task.cancel()

        await #expect(throws: CancellationError.self) { try await task.value }
        #expect(contents(work).isEmpty)
    }
}
