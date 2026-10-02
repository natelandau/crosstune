import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneExport

private let losAngeles = TimeZone(identifier: "America/Los_Angeles")!
/// Already 2026-10-03 in UTC, still 2026-10-02 in Los Angeles.
private let exportTime = Timestamp(iso: "2026-10-03T02:00:00.000Z")!.date
private let audioBytes = Data("not really audio".utf8)

/// A store holding one tune with one exportable recording, plus a recording with no local file.
private func seededStore(_ root: TemporaryRoot) async throws -> CrosstuneStore {
    let store = try root.open()
    let tune = Tune(title: "Angeline the Baker")
    let kept = Recording(tuneID: tune.id, source: "capture", recordedAt: noon)
    let remote = Recording(tuneID: tune.id, source: "capture", recordedAt: later(1000))
    try await store.write { writer in
        try writer.put(tune)
        try writer.put(UserTune(tuneID: tune.id, status: "learning"))
        try writer.put(kept)
        try writer.put(remote)
        try RecordingFile(id: kept.id, localState: .captured, fileName: "\(kept.id).m4a", updatedAt: noon)
            .insert(writer.db)
    }
    try audioBytes.write(to: store.audioFolder.appending(path: "\(kept.id).m4a"))
    return store
}

private func workFolder() -> URL {
    FileManager.default.temporaryDirectory
        .appending(path: "crosstune-export-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
}

private func contents(_ folder: URL) -> [String] {
    (try? FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false))) ?? []
}

private final class Calls: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [[Int]] = []

    func append(_ done: Int, _ total: Int) { lock.withLock { calls.append([done, total]) } }
    var all: [[Int]] { lock.withLock { calls } }
}

@Test func countsSayHowManyRecordingsThisDeviceCanExport() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let tune = Tune(title: "Cluck Old Hen")
    let onDevice = Recording(tuneID: tune.id, source: "capture", recordedAt: noon)
    let noRow = Recording(tuneID: tune.id, source: "capture", recordedAt: noon)
    let capturing = Recording(tuneID: tune.id, source: "capture", recordedAt: noon)
    let missingFile = Recording(tuneID: tune.id, source: "capture", recordedAt: noon)
    let deleted = Recording(deletedAt: noon, tuneID: tune.id, source: "capture", recordedAt: noon)
    try await store.write { writer in
        try writer.put(tune)
        try writer.put(UserTune(tuneID: tune.id, status: "learning"))
        for recording in [onDevice, noRow, capturing, missingFile, deleted] { try writer.put(recording) }
        try RecordingFile(id: onDevice.id, localState: .captured, fileName: "\(onDevice.id).m4a").insert(writer.db)
        try RecordingFile(id: capturing.id, localState: .capturing, fileName: "\(capturing.id).aac")
            .insert(writer.db)
        try RecordingFile(id: missingFile.id, localState: .downloaded, fileName: "\(missingFile.id).m4a")
            .insert(writer.db)
        try RecordingFile(id: deleted.id, localState: .downloaded, fileName: "\(deleted.id).m4a").insert(writer.db)
    }
    for id in [onDevice.id, deleted.id] {
        try audioBytes.write(to: store.audioFolder.appending(path: "\(id).m4a"))
    }
    try audioBytes.write(to: store.audioFolder.appending(path: "\(capturing.id).aac"))

    var counts = ExportArchive.counts(store: store).makeAsyncIterator()

    #expect(try await counts.next() == ExportCounts(onDevice: 1, total: 4))
}

@Test func countsRefreshWhenADownloadLands() async throws {
    let root = TemporaryRoot()
    let store = try root.open()
    let tune = Tune(title: "Cluck Old Hen")
    let recording = Recording(tuneID: tune.id, source: "capture", recordedAt: noon)
    try await store.write { writer in
        try writer.put(tune)
        try writer.put(UserTune(tuneID: tune.id, status: "learning"))
        try writer.put(recording)
    }
    var counts = ExportArchive.counts(store: store).makeAsyncIterator()
    #expect(try await counts.next() == ExportCounts(onDevice: 0, total: 1))

    try audioBytes.write(to: store.audioFolder.appending(path: "\(recording.id).m4a"))
    try await store.write { writer in
        try RecordingFile(id: recording.id, localState: .downloaded, fileName: "\(recording.id).m4a")
            .insert(writer.db)
    }

    #expect(try await counts.next() == ExportCounts(onDevice: 1, total: 1))
}

@Test func errorsSayWhatWentWrongInPlainWords() {
    #expect(
        ExportArchiveError.noLocalAudio("r1").localizedDescription
            == "A recording's audio is no longer on this device. Try exporting again.")
    #expect(
        StoredZipError.fileChanged("recordings/Reel/2026-09-20.m4a").localizedDescription
            == "recordings/Reel/2026-09-20.m4a changed while it was being exported. Try exporting again.")
}

@Test func theZipIsNamedForTheDayInTheDevicesTimeZone() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }

    let zip = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, progress: { _, _ in })

    #expect(zip.lastPathComponent == "crosstune-export-2026-10-02.zip")
    #expect(FileManager.default.fileExists(atPath: zip.path(percentEncoded: false)))
    #expect(contents(zip.deletingLastPathComponent()) == [zip.lastPathComponent])
}

@Test func progressCountsAudioFilesCopied() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    let calls = Calls()

    _ = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, progress: calls.append)

    #expect(calls.all == [[0, 1], [1, 1]])
}

@Test func cancellingLeavesNothingBehind() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }

    let task = Task {
        try await ExportArchive.make(
            store: store, now: exportTime, timeZone: losAngeles, root: work,
            progress: { _, _ in withUnsafeCurrentTask { $0?.cancel() } })
    }

    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(contents(work).isEmpty)
}

@Test func anAudioFileDeletedAfterTheExportStartsIsStillExported() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    let audioFolder = store.audioFolder
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }

    let zip = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, progress: { _, _ in },
        beforeWriting: {
            for name in try FileManager.default.contentsOfDirectory(atPath: audioFolder.path(percentEncoded: false)) {
                try FileManager.default.removeItem(at: audioFolder.appending(path: name))
            }
        })

    #expect(try Data(contentsOf: zip).range(of: audioBytes) != nil)
    #expect(contents(zip.deletingLastPathComponent()) == [zip.lastPathComponent])
}

@Test func anAudioFileGoneBeforeTheExportStartsIsLeftOut() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    try FileManager.default.removeItem(at: store.audioFolder)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    let calls = Calls()

    let zip = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, progress: calls.append)

    #expect(try Data(contentsOf: zip).range(of: audioBytes) == nil)
    #expect(calls.all == [[0, 0]])
}

@Test func anAudioFileReplacedAfterTheExportStartsKeepsTheBytesItHadThen() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    let audioFolder = store.audioFolder
    let replacement = Data("a newer trim of the take".utf8)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }

    let zip = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, progress: { _, _ in },
        beforeWriting: {
            for name in try FileManager.default.contentsOfDirectory(atPath: audioFolder.path(percentEncoded: false)) {
                try replacement.write(to: audioFolder.appending(path: name), options: .atomic)
            }
        })

    let bytes = try Data(contentsOf: zip)
    #expect(bytes.range(of: audioBytes) != nil)
    #expect(bytes.range(of: replacement) == nil)
}

@Test func onlyLiveRecordingsHaveTheirAudioPinned() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    let deleted = Recording(deletedAt: noon, tuneID: nil, source: "capture", recordedAt: noon)
    let orphanID = UUID().uuidString.lowercased()
    try await store.write { writer in
        try writer.put(deleted)
        try RecordingFile(id: deleted.id, localState: .downloaded, fileName: "\(deleted.id).m4a").insert(writer.db)
        try RecordingFile(id: orphanID, localState: .downloaded, fileName: "\(orphanID).m4a").insert(writer.db)
    }
    for id in [deleted.id, orphanID] {
        try audioBytes.write(to: store.audioFolder.appending(path: "\(id).m4a"))
    }
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    let pinned = Pinned()

    _ = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, progress: { _, _ in },
        beforeWriting: { pinned.set(pinnedNames(in: work)) })

    #expect(pinned.names.count == 1)
    #expect(!pinned.names.contains("\(deleted.id).m4a"))
    #expect(!pinned.names.contains("\(orphanID).m4a"))
}

@Test func aPinnedFileThatCannotBeRemovedLeavesTheZipInPlace() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    let audioFolder = store.audioFolder
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    // The flag sits on the inode the pinned link shares with the store's file.
    defer { try? setImmutable(false, inFolder: audioFolder) }

    let zip = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, progress: { _, _ in },
        beforeWriting: { try setImmutable(true, inFolder: audioFolder) })

    #expect(FileManager.default.fileExists(atPath: zip.path(percentEncoded: false)))
    #expect(try Data(contentsOf: zip).range(of: audioBytes) != nil)
}

private final class Pinned: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String] = []

    func set(_ names: [String]) { lock.withLock { stored = names } }
    var names: [String] { lock.withLock { stored } }
}

/// The audio pinned in the one export job under `work`.
private func pinnedNames(in work: URL) -> [String] {
    contents(work).flatMap { job in contents(work.appending(path: job).appending(path: "audio")) }
}

private func setImmutable(_ immutable: Bool, inFolder folder: URL) throws {
    for name in contents(folder) {
        var values = URLResourceValues()
        values.isUserImmutable = immutable
        var file = folder.appending(path: name)
        try file.setResourceValues(values)
    }
}

@Test func removeLeftoversDeletesEveryExportFolder() throws {
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    try FileManager.default.createDirectory(
        at: work.appending(path: UUID().uuidString), withIntermediateDirectories: true)

    ExportArchive.removeLeftovers(root: work)

    #expect(!FileManager.default.fileExists(atPath: work.path(percentEncoded: false)))
}

#if os(macOS)
    @Test func theZipHoldsBothCSVsAndTheLocalAudioAtItsRoot() async throws {
        let root = TemporaryRoot()
        let store = try await seededStore(root)
        let work = workFolder()
        defer { try? FileManager.default.removeItem(at: work) }

        let zip = try await ExportArchive.make(
            store: store, now: exportTime, timeZone: losAngeles, root: work, progress: { _, _ in })
        let path = zip.path(percentEncoded: false)

        let audioPath = "recordings/Angeline the Baker/2026-09-25.m4a"
        let names = String(decoding: try run("/usr/bin/unzip", ["-Z1", path]), as: UTF8.self)
            .split(separator: "\n").map(String.init)
        #expect(names == ["tunes.csv", "lists.csv", audioPath])
        #expect(try run("/usr/bin/unzip", ["-t", path]).contains(text: "No errors detected"))
        #expect(centralEntries(try Data(contentsOf: zip)).allSatisfy { $0.method == 0 && $0.flags & 0x0800 != 0 })
        #expect(try run("/usr/bin/unzip", ["-p", path, audioPath]) == audioBytes)
        let tunes = String(decoding: try run("/usr/bin/unzip", ["-p", path, "tunes.csv"]), as: UTF8.self)
        #expect(tunes.hasPrefix("\u{FEFF}title,"))
        #expect(tunes.contains(audioPath))
    }
#endif
