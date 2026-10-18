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
    let kept = Recording(tuneID: tune.id, source: "capture", addedAt: noon)
    let remote = Recording(tuneID: tune.id, source: "capture", addedAt: later(1000))
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
    let onDevice = Recording(tuneID: tune.id, source: "capture", addedAt: noon)
    let noRow = Recording(tuneID: tune.id, source: "capture", addedAt: noon)
    let capturing = Recording(tuneID: tune.id, source: "capture", addedAt: noon)
    let missingFile = Recording(tuneID: tune.id, source: "capture", addedAt: noon)
    let deleted = Recording(deletedAt: noon, tuneID: tune.id, source: "capture", addedAt: noon)
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
    let recording = Recording(tuneID: tune.id, source: "capture", addedAt: noon)
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
            == "Couldn't find a recording's audio to export. Try exporting again.")
    #expect(
        ExportArchiveError.noLocalScans("s1").localizedDescription
            == "Couldn't find a scan's image to export. Try exporting again.")
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

@Test func scansOnTheDeviceAreExportedAndCountedInProgress() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    let tune = try await store.read { db in try Tune.fetchOne(db)! }
    let first = ScanRecord(tuneID: tune.id, position: 0, width: 1, height: 1)
    let second = ScanRecord(tuneID: tune.id, position: 1, width: 1, height: 1)
    let away = ScanRecord(tuneID: tune.id, position: 2, width: 1, height: 1)
    try await store.write { writer in
        for scan in [first, second, away] { try writer.put(scan) }
        for scan in [first, second] {
            try ScanFile(scanID: scan.id, fileName: "\(scan.id).jpg", origin: .downloaded).insert(writer.db)
        }
    }
    for (scan, text) in [(first, "one"), (second, "two")] {
        try Data(text.utf8).write(to: store.scansFolder.appending(path: "\(scan.id).jpg"))
    }
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    let calls = Calls()

    let zip = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, progress: calls.append)

    let bytes = try Data(contentsOf: zip)
    #expect(bytes.range(of: Data("scans/Angeline the Baker/1.jpg".utf8)) != nil)
    #expect(bytes.range(of: Data("scans/Angeline the Baker/2.jpg".utf8)) != nil)
    #expect(bytes.range(of: Data("scans/Angeline the Baker/3.jpg".utf8)) == nil)
    #expect(calls.all == [[0, 3], [1, 3], [2, 3], [3, 3]])
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
    let deleted = Recording(deletedAt: noon, tuneID: nil, source: "capture", addedAt: noon)
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
    @Test func theZipHoldsTheCSVsAndTheLocalAudioAtItsRoot() async throws {
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
        #expect(names == ["tunes.csv", "lists.csv", "recordings.csv", audioPath])
        #expect(try run("/usr/bin/unzip", ["-t", path]).contains(text: "No errors detected"))
        #expect(centralEntries(try Data(contentsOf: zip)).allSatisfy { $0.method == 0 && $0.flags & 0x0800 != 0 })
        #expect(try run("/usr/bin/unzip", ["-p", path, audioPath]) == audioBytes)
        let tunes = String(decoding: try run("/usr/bin/unzip", ["-p", path, "tunes.csv"]), as: UTF8.self)
        #expect(tunes.hasPrefix("\u{FEFF}title,"))
        #expect(tunes.contains(audioPath))
    }
#endif

/// Writes a distinct body for each file asked for, and records the order asked.
private final class Fetches: @unchecked Sendable {
    private let lock = NSLock()
    private var asked: [ExportFile] = []

    static func body(_ file: ExportFile) -> Data {
        switch file {
        case .recording(let id): Data("fetched audio \(id)".utf8)
        case .scan(let id): Data("fetched scan \(id)".utf8)
        }
    }

    func fetch(_ file: ExportFile, to destination: URL) throws {
        lock.withLock { asked.append(file) }
        try Self.body(file).write(to: destination)
    }

    var all: [ExportFile] { lock.withLock { asked } }
}

private struct FetchRefused: Error, Equatable {}

/// The seeded store plus a ready recording and a ready scan with no file on this device.
private func storeMissingFiles(_ root: TemporaryRoot) async throws -> (CrosstuneStore, Recording, ScanRecord) {
    let store = try await seededStore(root)
    let tune = try await store.read { db in try Tune.fetchOne(db)! }
    let remote = Recording(
        tuneID: tune.id, source: "capture", addedAt: later(2000), state: "ready", playbackMime: "audio/mpeg")
    let scan = ScanRecord(tuneID: tune.id, position: 0, width: 1, height: 1, state: ScanRecord.ready)
    try await store.write { writer in
        try writer.put(remote)
        try writer.put(scan)
    }
    return (store, remote, scan)
}

private func fileRowCounts(_ store: CrosstuneStore) async throws -> [Int] {
    try await store.read { db in [try RecordingFile.fetchCount(db), try ScanFile.fetchCount(db)] }
}

@Test func filesThisDeviceDoesNotHoldAreFetchedIntoTheZipOnly() async throws {
    let root = TemporaryRoot()
    let (store, remote, scan) = try await storeMissingFiles(root)
    let audioBefore = contents(store.audioFolder)
    let scansBefore = contents(store.scansFolder)
    let rowsBefore = try await fileRowCounts(store)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    let fetches = Fetches()
    let calls = Calls()

    let zip = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, fetchMissing: fetches.fetch,
        progress: calls.append)

    #expect(Set(fetches.all) == [.recording(remote.id), .scan(scan.id)])
    let bytes = try Data(contentsOf: zip)
    #expect(bytes.range(of: audioBytes) != nil)
    #expect(bytes.range(of: Fetches.body(.recording(remote.id))) != nil)
    #expect(bytes.range(of: Fetches.body(.scan(scan.id))) != nil)
    #expect(bytes.range(of: Data("recordings/Angeline the Baker/2026-09-25.mp3".utf8)) != nil)
    let audioPath = try #require(bytes.range(of: Data("recordings/Angeline the Baker/2026-09-25.mp3".utf8)))
    let scanPath = try #require(bytes.range(of: Data("scans/Angeline the Baker/1.jpg".utf8)))
    // The zip keeps the plan's order, whichever fetch lands first.
    #expect(audioPath.lowerBound < scanPath.lowerBound)
    // Two fetches, then three files into the zip.
    #expect(calls.all == [[0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5]])
    #expect(contents(store.audioFolder) == audioBefore)
    #expect(contents(store.scansFolder) == scansBefore)
    #expect(try await fileRowCounts(store) == rowsBefore)
    #expect(contents(zip.deletingLastPathComponent()) == [zip.lastPathComponent])
}

@Test func aFileThatIsNotReadyIsNeitherFetchedNorExported() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    let tune = try await store.read { db in try Tune.fetchOne(db)! }
    try await store.write { writer in
        try writer.put(ScanRecord(tuneID: tune.id, position: 0, width: 1, height: 1))
    }
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    let fetches = Fetches()
    let calls = Calls()

    _ = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, fetchMissing: fetches.fetch,
        progress: calls.append)

    #expect(fetches.all.isEmpty)
    #expect(calls.all == [[0, 1], [1, 1]])
}

@Test func aFailedFetchFailsTheExportAndLeavesNothing() async throws {
    let root = TemporaryRoot()
    let (store, _, _) = try await storeMissingFiles(root)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }

    await #expect(throws: FetchRefused()) {
        try await ExportArchive.make(
            store: store, now: exportTime, timeZone: losAngeles, root: work,
            fetchMissing: { file, destination in
                guard case .scan = file else { return try Fetches.body(file).write(to: destination) }
                throw FetchRefused()
            },
            progress: { _, _ in })
    }
    #expect(contents(work).isEmpty)
}

/// Holds each fetch until `width` have started, so fetches made one at a time never get past
/// the first, and records the most under way at once.
private final class Overlap: @unchecked Sendable {
    private let lock = NSLock()
    private let width: Int
    private var started = 0
    private var running = 0
    private var mostRunning = 0

    init(width: Int) { self.width = width }

    var peak: Int { lock.withLock { mostRunning } }

    func fetch(_ file: ExportFile, to destination: URL) async throws {
        lock.withLock {
            started += 1
            running += 1
            mostRunning = max(mostRunning, running)
        }
        defer { lock.withLock { running -= 1 } }
        guard try await poll({ self.lock.withLock { self.started >= self.width } }) else { throw FetchRefused() }
        try Fetches.body(file).write(to: destination)
    }
}

/// The store from ``storeMissingFiles(_:)`` plus two more ready scans with no file here.
private func storeMissingFourFiles(_ root: TemporaryRoot) async throws -> CrosstuneStore {
    let (store, _, _) = try await storeMissingFiles(root)
    let tune = try await store.read { db in try Tune.fetchOne(db)! }
    try await store.write { writer in
        for position in 1...2 {
            try writer.put(
                ScanRecord(tuneID: tune.id, position: position, width: 1, height: 1, state: ScanRecord.ready))
        }
    }
    return store
}

@Test func missingFilesAreFetchedThreeAtATime() async throws {
    let root = TemporaryRoot()
    let store = try await storeMissingFourFiles(root)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    let overlap = Overlap(width: 3)
    let calls = Calls()

    _ = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, fetchMissing: overlap.fetch,
        progress: calls.append)

    #expect(overlap.peak == 3)
    // Four fetches, then five files into the zip.
    #expect(calls.all == (0...9).map { [$0, 9] })
}

@Test func aFailedFetchStopsTheFetchesStillUnderWay() async throws {
    let root = TemporaryRoot()
    let (store, _, _) = try await storeMissingFiles(root)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    let outlived = Flag()

    await #expect(throws: FetchRefused()) {
        try await ExportArchive.make(
            store: store, now: exportTime, timeZone: losAngeles, root: work,
            fetchMissing: { file, destination in
                guard case .recording = file else { throw FetchRefused() }
                // Ends only by cancellation, which the poll's sleep throws.
                if try await poll({ false }) { return }
                outlived.set()
            },
            progress: { _, _ in })
    }
    #expect(!outlived.isSet)
    #expect(contents(work).isEmpty)
}

private final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func set() { lock.withLock { value = true } }
    var isSet: Bool { lock.withLock { value } }
}

@Test func cancellingDuringAFetchLeavesNothing() async throws {
    let root = TemporaryRoot()
    let (store, _, _) = try await storeMissingFiles(root)
    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }

    let fetching = Flag()
    let task = Task {
        try await ExportArchive.make(
            store: store, now: exportTime, timeZone: losAngeles, root: work,
            fetchMissing: { file, destination in
                try Fetches.body(file).write(to: destination)
                fetching.set()
                // Ends only by cancellation, which the poll's sleep throws.
                _ = try await poll { false }
            },
            progress: { _, _ in })
    }
    #expect(try await poll { fetching.isSet })

    task.cancel()

    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(contents(work).isEmpty)
}

@Test func countsNameTheFilesThatMustBeFetched() async throws {
    let root = TemporaryRoot()
    let (store, _, _) = try await storeMissingFiles(root)
    let tune = try await store.read { db in try Tune.fetchOne(db)! }
    let held = ScanRecord(tuneID: tune.id, position: 1, width: 1, height: 1, state: ScanRecord.ready)
    let pending = ScanRecord(tuneID: tune.id, position: 2, width: 1, height: 1)
    try await store.write { writer in
        try writer.put(held)
        try writer.put(pending)
        try ScanFile(scanID: held.id, fileName: "\(held.id).jpg", origin: .downloaded).insert(writer.db)
    }
    try Data("held".utf8).write(to: store.scansFolder.appending(path: "\(held.id).jpg"))

    var counts = ExportArchive.counts(store: store).makeAsyncIterator()

    // Recordings: one held, one ready elsewhere, one not ready. Scans: one held, one ready
    // elsewhere, one not ready.
    #expect(try await counts.next() == ExportCounts(onDevice: 2, total: 6, missing: 2))
}

@Test func countsMissOnlyWhatTheExportFetches() async throws {
    let root = TemporaryRoot()
    let store = try await seededStore(root)
    // A tune with no user-tune row is not exported: its recording goes under Unfiled, and its
    // scan is left out.
    let orphan = Tune(title: "Soldier's Joy")
    let recording = Recording(tuneID: orphan.id, source: "capture", addedAt: noon, state: "ready")
    let scan = ScanRecord(tuneID: orphan.id, position: 0, width: 1, height: 1, state: ScanRecord.ready)
    try await store.write { writer in
        try writer.put(orphan)
        try writer.put(recording)
        try writer.put(scan)
    }
    var counts = ExportArchive.counts(store: store).makeAsyncIterator()
    #expect(try await counts.next() == ExportCounts(onDevice: 1, total: 3, missing: 1))

    let work = workFolder()
    defer { try? FileManager.default.removeItem(at: work) }
    let fetches = Fetches()
    _ = try await ExportArchive.make(
        store: store, now: exportTime, timeZone: losAngeles, root: work, fetchMissing: fetches.fetch,
        progress: { _, _ in })
    #expect(fetches.all == [.recording(recording.id)])
}
