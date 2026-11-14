import CrosstuneAnalytics
import CrosstuneExport
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Synchronization
import Testing

@testable import CrosstuneUI

/// Holds a preparation until the test lets it finish.
private actor Gate {
    private var result: RecordingExportResult?
    private var waiting: CheckedContinuation<RecordingExportResult, Never>?

    func wait() async -> RecordingExportResult {
        if let result { return result }
        return await withCheckedContinuation { waiting = $0 }
    }

    func finish(_ result: RecordingExportResult) {
        if let waiting {
            self.waiting = nil
            waiting.resume(returning: result)
        } else {
            self.result = result
        }
    }
}

private func item(_ readiness: ExportReadiness = .fetch) -> RecordingExportItem {
    RecordingExportItem(
        recordingID: UUID().uuidString,
        name: NameInput(title: "Jam", titleIsDate: false, recordedAt: nil, precision: nil, fileExtension: "m4a"),
        album: nil, readiness: readiness)
}

private func request(
    _ items: [RecordingExportItem] = [item()], delivery: RecordingExportRequest.Delivery = .share
) -> RecordingExportRequest {
    RecordingExportRequest(items: items, delivery: delivery, title: "Jam")
}

/// The events the model sent.
private final class Sent: Sendable {
    let events = Mutex<[AnalyticsEvent]>([])
}

/// The folders a write was asked to fill, failing while `fails` is set.
private final class Writes: Sendable {
    let folders = Mutex<[URL]>([])
    let fails = Mutex(false)
}

private struct DiskFull: Error {}

@MainActor
@Suite struct RecordingExportModelTests {
    private let sent = Sent()
    private let writes = Writes()

    private var analytics: AnalyticsClient {
        let sent = sent
        return AnalyticsClient.noop.observing { event in sent.events.withLock { $0.append(event) } }
    }

    /// A job folder holding `files` files, as `RecordingExport.prepare` leaves it.
    private func job(files: Int, fetched: Int = 0, blocked: Int = 0, failed: Int = 0) throws -> RecordingExportResult {
        let folder = FileManager.default.temporaryDirectory.appending(path: "recording-export-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let urls = try (0..<files).map { index in
            let url = folder.appending(path: "Jam \(index).m4a")
            try Data("audio".utf8).write(to: url)
            return url
        }
        return RecordingExportResult(folder: folder, files: urls, fetched: fetched, blocked: blocked, failed: failed)
    }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
    }

    private func model(_ result: RecordingExportResult, _ request: RecordingExportRequest = request())
        -> RecordingExportModel
    {
        model({ result }, request)
    }

    private func model(
        _ result: @escaping @Sendable () async throws -> RecordingExportResult,
        _ request: RecordingExportRequest = request()
    ) -> RecordingExportModel {
        let writes = writes
        return RecordingExportModel(
            request: request,
            prepare: { _, progress in
                progress(0, 1)
                return try await result()
            },
            write: { _, folder in
                if writes.fails.withLock({ $0 }) { throw DiskFull() }
                writes.folders.withLock { $0.append(folder) }
            }, analytics: analytics)
    }

    @Test func aPreparedFileWaitsForTheHandOffThenGoesAndIsReported() async throws {
        let result = try job(files: 1, fetched: 1)
        let model = model(result, request(delivery: .saveFile))
        model.open()
        try await eventually { model.prepared != nil }
        #expect(model.prepared?.files == result.files)
        #expect(model.stage == .handingOff(asking: true))
        #expect(exists(result.folder))

        #expect(model.finishHandOff(delivered: true) == .delivered(leftOut: nil))
        #expect(model.prepared == nil)
        #expect(!exists(result.folder))
        #expect(sent.events.withLock { $0 } == [.recordingExported(method: .save, count: 1, fetched: 1, skipped: 0)])
    }

    @Test func aHandOffBackedOutOfDeletesTheFileAndReportsNothing() async throws {
        let result = try job(files: 1)
        let model = model(result)
        await model.start()?.value
        #expect(model.finishHandOff(delivered: false) == .backedOut)
        #expect(!exists(result.folder))
        #expect(sent.events.withLock { $0 }.isEmpty)
    }

    /// A service that reads the file after the sheet has gone keeps it past the model, then
    /// reports the share and deletes the file once it is done.
    @Test func aDetachedHandOffOutlivesTheModel() async throws {
        let result = try job(files: 1)
        var model: RecordingExportModel? = model(result)
        await model?.start()?.value
        let done = try #require(model?.detachHandOff())
        weak let gone = model
        model = nil
        try await eventually { gone == nil }
        #expect(exists(result.folder))
        #expect(sent.events.withLock { $0 }.isEmpty)

        done()
        #expect(!exists(result.folder))
        #expect(sent.events.withLock { $0 } == [.recordingExported(method: .share, count: 1, fetched: 0, skipped: 0)])
    }

    /// A failed write shows why and keeps the files, and the next try asks for a folder again
    /// rather than preparing them again.
    @Test func aFailedWriteKeepsTheFilesAndTheRetryAsksForAFolderAgain() async throws {
        let result = try job(files: 2)
        let model = model(result, request([item(), item()], delivery: .saveIntoFolder))
        await model.start()?.value
        writes.fails.withLock { $0 = true }
        let folder = URL(filePath: "/tmp/chosen")
        #expect(await model.write(into: folder) == nil)
        #expect(model.failure == failureMessage(DiskFull()))
        #expect(model.prepared?.files == result.files)
        #expect(exists(result.folder))
        #expect(sent.events.withLock { $0 }.isEmpty)

        model.retry()
        #expect(model.stage == .handingOff(asking: true))
        writes.fails.withLock { $0 = false }
        #expect(await model.write(into: folder) == .delivered(leftOut: nil))
        #expect(writes.folders.withLock { $0 } == [folder])
        #expect(!exists(result.folder))
        #expect(sent.events.withLock { $0 } == [.recordingExported(method: .save, count: 2, fetched: 0, skipped: 0)])
    }

    /// A save panel that fails to save shows why and keeps the file, and the next try opens the
    /// panel again rather than preparing the file again.
    @Test func aFailedSaveKeepsTheFileAndTheRetryOpensThePanelAgain() async throws {
        let result = try job(files: 1)
        let model = model(result, request(delivery: .saveFile))
        await model.start()?.value
        model.stopAsking()
        model.saveFailed(DiskFull())
        #expect(model.failure == failureMessage(DiskFull()))
        #expect(model.prepared?.files == result.files)
        #expect(exists(result.folder))
        #expect(sent.events.withLock { $0 }.isEmpty)

        model.retry()
        #expect(model.stage == .handingOff(asking: true))
    }

    @Test func noFolderPickedLetsTheFilesGo() async throws {
        let result = try job(files: 2)
        let model = model(result, request([item(), item()], delivery: .saveIntoFolder))
        await model.start()?.value
        #expect(await model.write(into: nil) == .backedOut)
        #expect(!exists(result.folder))
        #expect(writes.folders.withLock { $0 }.isEmpty)
    }

    /// The job skips a recording whose fetch failed, so when every fetch fails there is no file:
    /// the failure is told as a failed row download is, and Try again prepares them again.
    @Test func everyFetchFailingShowsTheErrorAndTryAgainRunsAgain() async throws {
        let empty = try job(files: 0, failed: 2)
        let full = try job(files: 2)
        let results = Mutex([empty, full])
        let model = model({ results.withLock { $0.removeFirst() } }, request([item(), item()]))
        await model.start()?.value
        #expect(model.failure == RecordingText.downloadFailed)
        #expect(model.prepared == nil)
        #expect(!exists(empty.folder))
        #expect(sent.events.withLock { $0 }.isEmpty)

        model.retry()
        #expect(model.stage == .preparing)
        try await eventually { model.prepared != nil }
        #expect(model.prepared?.files == full.files)
    }

    /// The end line counts only the fetches that failed, never the recordings skipped up front.
    @Test(arguments: [(0, nil), (1, RecordingExportText.leftOut(1)), (2, RecordingExportText.leftOut(2))])
    func theEndLineCountsOnlyFailedFetches(failed: Int, line: String?) async throws {
        let result = try job(files: 1, fetched: 2 - failed, blocked: 1, failed: failed)
        let model = model(result, request([item(.blocked(.capturing)), item(), item(), item()]))
        await model.start()?.value
        #expect(model.finishHandOff(delivered: true) == .delivered(leftOut: line))
    }

    /// A notice of skipped recordings holds the run until the musician goes on.
    @Test func aNoticeHoldsTheRunUntilTheMusicianContinues() async throws {
        let result = try job(files: 1)
        let model = model(result, request([item(.blocked(.offline)), item()]))
        model.open()
        #expect(model.notice == RecordingExportText.skipped(1, of: 2))
        #expect(model.prepared == nil)
        await model.start()?.value
        #expect(model.notice == nil)
        #expect(model.prepared?.files == result.files)
    }

    @Test func aRunCancelledBeforeItFinishesHandsNothingOff() async throws {
        let result = try job(files: 1)
        let gate = Gate()
        let model = model({ await gate.wait() })
        let run = model.start()
        #expect(model.isBusy)
        model.cancel()
        await gate.finish(result)
        await run?.value
        #expect(model.prepared == nil)
        #expect(!model.isBusy)
        #expect(!exists(result.folder))
    }

    @Test func theFileIsNamedForTheRecordingsTitleAndDateWithTheTuneAsAlbum() throws {
        let recorded = try #require(ISO8601DateFormatter().date(from: "2026-09-14T12:00:00Z"))
        func view(label: String?, tuneTitle: String?) -> RecordingView {
            RecordingView(
                recording: Recording(
                    id: "r1", tuneID: tuneTitle == nil ? nil : "t1", source: "microphone",
                    recordedAt: Timestamp(recorded), recordedPrecision: RecordingPrecision.day.rawValue,
                    label: label, state: "ready", playbackMime: "audio/mpeg"),
                file: nil, tuneID: tuneTitle == nil ? nil : "t1", tuneTitle: tuneTitle, shownPlace: "Ray's",
                holdsSplitAudio: false)
        }
        let utc = try #require(TimeZone(identifier: "UTC"))
        let labeled = RecordingExportItem(view(label: "Jam at Mike's", tuneTitle: "Cluck Old Hen"), readiness: .fetch)
        #expect(fileNames([labeled.name], timeZone: utc) == ["Jam at Mike's 2026-09-14.mp3"])
        #expect(labeled.album == "Cluck Old Hen")
        let unnamed = RecordingExportItem(view(label: nil, tuneTitle: nil), readiness: .fetch)
        #expect(unnamed.name.titleIsDate)
        #expect(unnamed.album == nil)
    }
}
