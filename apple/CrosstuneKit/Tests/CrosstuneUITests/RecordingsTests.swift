import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: () async throws -> Bool) async throws {
    if try await poll({ try await condition() }) { return }
    Issue.record("The condition never held")
}

private func view(_ id: String, tune: String?, minutes: Int64) -> RecordingView {
    RecordingView(
        recording: Recording(
            id: id, tuneID: tune, source: "microphone", recordedAt: later(minutes * 60_000), state: "ready"),
        file: nil, tuneID: tune, tuneTitle: tune.map { "Tune \($0)" })
}

private func putRecording(
    _ store: CrosstuneStore, _ id: String, tuneID: String? = nil, minutes: Int64 = 0, state: String = "ready",
    file: RecordingFile? = nil
) async throws {
    try await store.write { writer in
        try writer.put(
            Recording(
                id: id, tuneID: tuneID, source: "microphone", recordedAt: later(minutes * 60_000), state: state),
            at: noon)
        try file?.upsert(writer.db)
    }
}

/// A server that answers nothing, so a download fetches no audio.
private struct RefusingSyncAPI: SyncAPI {
    func push(_ changes: [Change]) async throws -> [PushResult] { [] }
    func pull(since: Int64) async throws -> PullPage { PullPage(rows: [], nextSince: since, hasMore: false) }
    func storage() async throws -> StorageFigures { StorageFigures(usedBytes: 0, quotaBytes: 0, maxFileBytes: 0) }
    func resolveLink(url: String) async throws -> ResolvedLink { throw URLError(.badURL) }
    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
        throw URLError(.badURL)
    }
    func uploadFinished(recordingID: String) async throws { throw URLError(.badURL) }
    func downloadURL(recordingID: String) async throws -> URL { throw URLError(.badServerResponse) }
    func retryRecording(recordingID: String) async throws { throw URLError(.badURL) }
    func putObject(_ url: URL, file: URL, contentType: String) async throws { throw URLError(.badURL) }
    func getObject(_ url: URL, to destination: URL) async throws { throw URLError(.badURL) }
}

@Suite struct RecordingGroupTests {
    @Test func putsUnfiledFirstThenEachTuneByItsNewestRecording() {
        let views = RecordingsModel.sorted([
            view("a_old", tune: "a", minutes: 1),
            view("loose_old", tune: nil, minutes: 2),
            view("b_new", tune: "b", minutes: 9),
            view("a_new", tune: "a", minutes: 5),
            view("loose_new", tune: nil, minutes: 3),
        ])
        #expect(views.map(\.id) == ["loose_new", "loose_old", "b_new", "a_new", "a_old"])

        let groups = RecordingGroup.grouped(views)
        #expect(groups.map(\.title) == ["Unfiled", "Tune b", "Tune a"])
        #expect(groups.map(\.tuneID) == [nil, "b", "a"])
        #expect(groups.map { $0.views.map(\.id) } == [["loose_new", "loose_old"], ["b_new"], ["a_new", "a_old"]])
    }

    @Test func leavesOutAnUnfiledGroupWhenEveryRecordingIsFiled() {
        let groups = RecordingGroup.grouped([view("a", tune: "a", minutes: 1)])
        #expect(groups.map(\.title) == ["Tune a"])
        #expect(RecordingGroup.grouped([]).isEmpty)
    }

    @Test func warnsThatARecordingNeverUploadedCannotComeBack() {
        let waiting = RecordingView(
            recording: Recording(id: "r", tuneID: nil, source: "microphone", recordedAt: noon, state: "pending_upload"),
            file: RecordingFile(id: "r", localState: .captured), tuneID: nil, tuneTitle: nil)
        #expect(RecordingsModel.deleteMessage(waiting) == RecordingsModel.deleteUnsyncedNote)
        let uploaded = RecordingView(
            recording: waiting.recording, file: RecordingFile(id: "r", localState: .uploaded), tuneID: nil,
            tuneTitle: nil)
        #expect(RecordingsModel.deleteMessage(uploaded) == RecordingsModel.deleteSyncedNote)
        #expect(RecordingsModel.deleteMessage(view("r", tune: nil, minutes: 0)) == RecordingsModel.deleteSyncedNote)
    }
}

@MainActor
@Suite struct RecordingsModelTests {
    @Test func readsLiveRecordingsGroupedWithUnfinishedCapturesAndStorage() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let (kept, _) = try await commands.createTune(
            TuneInput(title: "Kitchen Girl"), userTune: UserTuneInput(status: "known"))
        let (gone, _) = try await commands.createTune(
            TuneInput(title: "Gone Tune"), userTune: UserTuneInput(status: "known"))
        try await putRecording(store, "filed", tuneID: kept, minutes: 1)
        try await putRecording(store, "orphan", tuneID: gone, minutes: 2)
        try await putRecording(store, "loose", minutes: 3)
        try await putRecording(store, "deleted", minutes: 4)
        try await store.write { writer in
            // As a pull from another device leaves it: the tune gone, its recording still here.
            try writer.tombstone(Tune.self, id: gone, at: noon)
            try writer.tombstone(Recording.self, id: "deleted", at: noon)
            try RecordingFile(id: "stuck", localState: .capturing, fileName: "stuck.aac", recordedAt: noon)
                .insert(writer.db)
            try writer.setMeta(.storage, to: StorageFigures(usedBytes: 5, quotaBytes: 10, maxFileBytes: 4))
        }

        let model = RecordingsModel(store: store)
        try await eventually { model.groups != nil }
        let groups = try #require(model.groups)
        // A recording whose tune was deleted elsewhere reads as unfiled.
        #expect(groups.map(\.title) == ["Unfiled", "Kitchen Girl"])
        #expect(groups[0].views.map(\.id) == ["loose", "orphan"])
        #expect(groups[1].views.map(\.id) == ["filed"])
        #expect(model.unfinished.map(\.id) == ["stuck"])
        #expect(model.storage?.usedBytes == 5)
    }

    @Test func hidesStorageUntilTheServerSaysWhatTheQuotaIs() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 0, quotaBytes: 0, maxFileBytes: 0))
        let model = RecordingsModel(store: store)
        try await eventually { model.groups != nil }
        #expect(model.storage == nil)
    }

    @Test func discardsAnUnfinishedCaptureAndItsAudio() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let audio = store.audioFolder.appending(path: "stuck.aac")
        try Data(repeating: 1, count: 16).write(to: audio)
        try await store.write { writer in
            try RecordingFile(id: "stuck", localState: .capturing, fileName: "stuck.aac", recordedAt: noon)
                .insert(writer.db)
        }
        let model = RecordingsModel(store: store)
        try await eventually { !model.unfinished.isEmpty }

        await model.discard(try #require(model.unfinished.first))
        #expect(model.failure == nil)
        try await eventually { model.unfinished.isEmpty }
        #expect(!FileManager.default.fileExists(atPath: audio.path(percentEncoded: false)))
    }

    @Test func deletesARecordingAndTakesOneOutOfItsTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Kitchen Girl"), userTune: UserTuneInput(status: "known"))
        try await putRecording(store, "filed", tuneID: tuneID)
        try await putRecording(store, "loose", minutes: 1)
        let model = RecordingsModel(store: store)
        try await eventually { model.groups?.count == 2 }

        await model.removeFromTune("filed")
        try await eventually { model.groups?.map(\.title) == ["Unfiled"] }
        await model.delete("loose")
        try await eventually { model.groups?.first?.views.map(\.id) == ["filed"] }
        #expect(model.failure == nil)
    }

    @Test func reportsAWriteThatFails() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let model = RecordingsModel(store: store)
        await model.removeFromTune("missing")
        #expect(model.failure == CommandError.recordingNotFoundMessage)
    }
}

@MainActor
@Suite struct RecordingSheetModelTests {
    @Test func renamesARecordingAndClearsItsNameWhenLeftBlank() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let rename = RenameRecordingModel(store: store, recordingID: "r1", label: nil)
        #expect(!rename.isEdited)
        rename.setName("  Take 2  ")
        #expect(rename.isEdited)
        #expect(await rename.save())
        #expect(!(await rename.save()))
        let label = try await store.read { db in try Recording.fetchOne(db, key: "r1")?.label }
        #expect(label == "Take 2")

        let clear = RenameRecordingModel(store: store, recordingID: "r1", label: "Take 2")
        clear.setName("   ")
        #expect(await clear.save())
        let cleared = try await store.read { db in try Recording.fetchOne(db, key: "r1") }
        #expect(cleared?.label == nil)
    }

    @Test func reportsARenameThatFails() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let rename = RenameRecordingModel(store: store, recordingID: "missing", label: nil)
        #expect(!(await rename.save()))
        #expect(rename.failure == CommandError.recordingNotFoundMessage)
        rename.setName("x")
        #expect(rename.failure == nil)
    }

    @Test func filesARecordingUnderThePickedTune() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let (tuneID, _) = try await Commands(store: store).createTune(
            TuneInput(title: "Kitchen Girl"), userTune: UserTuneInput(status: "known"))
        try await putRecording(store, "r1")
        let model = AddToTuneModel(store: store, recordingID: "r1")
        try await eventually { model.results != nil }
        #expect(model.results?.rows.isEmpty == true)

        model.query = "kitchen"
        let entry = try #require(model.results?.rows.first)
        #expect(AddToTuneModel.rowName(entry) == "Add to Kitchen Girl")
        #expect(await model.pick(entry))
        let filed = try await store.read { db in try Recording.fetchOne(db, key: "r1")?.tuneID }
        #expect(filed == tuneID)
    }

    @Test func offersToStartATuneWhenNothingMatches() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let model = AddToTuneModel(store: store, recordingID: "r1")
        try await eventually { model.results != nil }
        model.query = "Sally Goodin"
        #expect(model.results?.outcome.offerLabel == "Add \"Sally Goodin\"")
        #expect(await model.submit() == .create(title: "Sally Goodin"))
    }
}

@MainActor
@Suite struct RecordingImportTests {
    private func write(_ name: String, bytes: Int, in root: TemporaryRoot) throws -> URL {
        let folder = root.url.appending(path: "picked", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name)
        try Data(repeating: 7, count: bytes).write(to: url)
        return url
    }

    @Test func copiesAnAudioFileInAsAnUnfiledRecordingNamedForIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let picked = try write("Jam at Tom's.m4a", bytes: 1_000, in: root)
        let id = try await RecordingImport.add(picked, to: store, tuneID: nil, at: noon)

        let (recording, file) = try await store.read { db in
            (try Recording.fetchOne(db, key: id), try RecordingFile.fetchOne(db, key: id))
        }
        #expect(recording?.label == "Jam at Tom's")
        #expect(recording?.source == "upload")
        #expect(recording?.tuneID == nil)
        #expect(file?.localState == .captured)
        #expect(file?.bytes == 1_000)
        #expect(file?.contentType?.hasPrefix("audio/") == true)
        let name = try #require(file?.fileName)
        #expect(
            FileManager.default.fileExists(atPath: store.audioFolder.appending(path: name).path(percentEncoded: false)))
        #expect(FileManager.default.fileExists(atPath: picked.path(percentEncoded: false)))
    }

    @Test func anImportedAACFileSurvivesRecoveryAndTheSweep() async throws {
        let root = TemporaryRoot()
        let first = try root.open()
        let id = try await RecordingImport.add(try write("Jam.aac", bytes: 1_000, in: root), to: first, tuneID: nil)
        try first.close()

        let store = try root.open()
        await Recorder.recoverLeftoverCaptures(in: store)

        let file = try #require(try await store.read { db in try RecordingFile.fetchOne(db, key: id) })
        #expect(file.localState == .captured)
        let name = try #require(file.fileName)
        #expect(name != CaptureFiles.captureName(id), "an import never takes a capture's name")
        #expect(
            FileManager.default.fileExists(atPath: store.audioFolder.appending(path: name).path(percentEncoded: false)))
    }

    @Test func refusesWhatTheServerWouldNeverTake() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.setMeta(.storage, to: StorageFigures(usedBytes: 0, quotaBytes: 10_000, maxFileBytes: 2_000_000))
        let cases: [(URL, String)] = [
            (try write("notes.txt", bytes: 10, in: root), RecordingImport.notAudio),
            (try write("empty.mp3", bytes: 0, in: root), RecordingImport.emptyFile),
            (try write("huge.wav", bytes: 2_000_001, in: root), "Files are limited to 2 MB."),
        ]
        for (url, message) in cases {
            await #expect(throws: RecordingImport.Refusal(message: message)) {
                try await RecordingImport.add(url, to: store, tuneID: nil)
            }
        }
        let count = try await store.read { db in try Recording.fetchCount(db) }
        #expect(count == 0)
        let copied = try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path(percentEncoded: false))
        #expect(copied.isEmpty)
    }
}

@MainActor
@Suite struct RecordingTransferTests {
    @Test func remembersADownloadThatFetchedNothing() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await putRecording(store, "r1")
        let engine = SyncEngine(store: store, api: RefusingSyncAPI(), isOffline: { false }, sleep: { _ in })
        let transfers = RecordingTransferActions(engine: engine, store: store)

        await transfers.download("r1")
        #expect(transfers.failedDownloads == ["r1"])
        #expect(!transfers.isDownloading("r1"))

        await transfers.download("r1")
        #expect(transfers.failedDownloads == ["r1"])
    }

    @Test func dimsAPlayWhileATakeIsRecordedAndSaysWhy() throws {
        let recording = Recording(id: "r1", tuneID: nil, source: "microphone", recordedAt: noon, state: "ready")
        let held = RecordingFile(id: "r1", localState: .downloaded, fileName: "r1.m4a")
        let blocked = RecordingRowContent(recording: recording, file: held, tuneTitle: nil, playBlocked: true)
        #expect(blocked.isDimmed)
        #expect(blocked.notice == MediaText.stopRecordingToPlay)
        // The tap stays, and the player refuses it.
        #expect(blocked.tap == .play)
        let free = RecordingRowContent(recording: recording, file: held, tuneTitle: nil)
        #expect(!free.isDimmed && free.notice == nil)
        // Only a play is refused; a download row carries on as it was.
        let download = RecordingRowContent(recording: recording, file: nil, tuneTitle: nil, playBlocked: true)
        #expect(download.notice == nil && !download.isDimmed)

        var link = RecordingLink(id: "l1", tuneID: "t1", url: "https://example.com/x", provider: "youtube")
        link.providerRef = "dQw4w9WgXcQ"
        let linkRow = LinkRowContent(link: link, embeddable: true, playBlocked: true)
        #expect(linkRow.isDimmed && linkRow.notice == MediaText.stopRecordingToPlay && linkRow.tap == .play)
        let opened = LinkRowContent(link: link, embeddable: false, playBlocked: true)
        #expect(!opened.isDimmed && opened.notice == nil)
    }

    @Test func asksToDeleteAnUnfinishedCaptureWhenItsRowIsTapped() {
        let capture = RecordingFile(id: "c1", localState: .capturing, recordedAt: noon)
        let row = UnfinishedCaptureRowContent(
            capture: capture, locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "UTC")!)
        #expect(row.verb == RecordingRowActions.delete)
        #expect(row.title == "Recording, Sep 25, 2026 at 12:00\u{202F}PM")
    }

    @Test func saysCouldNotDownloadOnlyWhileTheRowStillOffersADownload() {
        let recording = Recording(id: "r1", tuneID: nil, source: "microphone", recordedAt: noon, state: "ready")
        let failed = RecordingRowContent(recording: recording, file: nil, tuneTitle: nil, downloadFailed: true)
        #expect(failed.error == RecordingText.downloadFailed)
        #expect(failed.tap == .download)

        let fetchedSince = RecordingRowContent(
            recording: recording, file: RecordingFile(id: "r1", localState: .downloaded, fileName: "r1.m4a"),
            tuneTitle: nil, downloadFailed: true)
        #expect(fetchedSince.error == nil)
        #expect(fetchedSince.tap == .play)
    }
}

@MainActor
@Suite struct RecorderHostCaptureTests {
    @Test func holdsPlaybackBackWhileARecordSheetHasTheRecorder() throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let host = RecorderHost()
        #expect(!host.isCapturing)
        _ = try #require(host.claim(for: store))
        #expect(host.isCapturing)
        host.release()
        #expect(!host.isCapturing)
    }
}
