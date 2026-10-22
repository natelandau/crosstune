import CrosstuneExport
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// Holds an export until the test lets it finish, and counts how often one started.
private actor Gate {
    private var result: Result<URL, any Error>?
    private var waiting: CheckedContinuation<URL, any Error>?
    private(set) var starts = 0

    func wait() async throws -> URL {
        starts += 1
        if let result { return try result.get() }
        return try await withCheckedThrowingContinuation { waiting = $0 }
    }

    func finish(_ result: Result<URL, any Error>) {
        if let waiting {
            self.waiting = nil
            waiting.resume(with: result)
        } else {
            self.result = result
        }
    }
}

@MainActor
private final class Connection {
    var isOffline = true
}

private struct DiskFull: LocalizedError {
    var errorDescription: String? { "The disk is full." }
}

/// Counts that arrive once and never change.
private func countsOnce(_ onDevice: Int, _ total: Int, missing: Int = 0)
    -> @Sendable () -> AsyncThrowingStream<ExportCounts, any Error>
{
    {
        AsyncThrowingStream {
            $0.yield(ExportCounts(onDevice: onDevice, total: total, missing: missing))
            $0.finish()
        }
    }
}

@MainActor
@Suite struct ExportDataSheetTests {
    /// A zip in a folder of its own, as `ExportArchive.make` leaves it.
    private func makeZip() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: "export-sheet-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let zip = folder.appending(path: "crosstune-export-2026-10-02.zip")
        try Data("zip".utf8).write(to: zip)
        return zip
    }

    private func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
    }

    private func model(_ gate: Gate, counts: (Int, Int) = (2, 2)) async -> ExportDataModel {
        let model = ExportDataModel(
            exporter: Exporter(
                counts: countsOnce(counts.0, counts.1),
                make: { progress in
                    progress(0, 2)
                    return try await gate.wait()
                }))
        await model.followCounts()
        return model
    }

    @Test func needsConnectionAgreesWithItsCount() {
        #expect(
            ExportText.needsConnection(missing: 1)
                == "Connect to the internet to export 1 file that is not on this device.")
        #expect(
            ExportText.needsConnection(missing: 3)
                == "Connect to the internet to export 3 files that are not on this device.")
    }

    @Test func theNoteSaysEverythingIsExportedWhateverIsOnTheDevice() async {
        let model = ExportDataModel(
            exporter: Exporter(counts: countsOnce(1, 4, missing: 3), make: { _ in throw DiskFull() }))
        await model.followCounts()
        #expect(model.note == ExportDataSheet.completeNote)
    }

    @Test func offlineWithFilesToFetchTheNoteSaysSoAndExportRefusesOnTap() async throws {
        let gate = Gate()
        let model = ExportDataModel(
            exporter: Exporter(counts: countsOnce(1, 3, missing: 2), make: { _ in try await gate.wait() }),
            isOffline: { true })
        await model.followCounts()
        #expect(model.note == ExportText.needsConnection(missing: 2))
        #expect(model.canStart)
        #expect(model.start() == nil)
        #expect(model.failure == nil)
        #expect(!model.isRunning)
        #expect(await gate.starts == 0)
    }

    @Test func theNoteFollowsConnectivity() async {
        let connection = Connection()
        let model = ExportDataModel(
            exporter: Exporter(counts: countsOnce(1, 3, missing: 2), make: { _ in throw DiskFull() }),
            isOffline: { connection.isOffline })
        await model.followCounts()
        #expect(model.note == ExportText.needsConnection(missing: 2))
        connection.isOffline = false
        #expect(model.note == ExportDataSheet.completeNote)
    }

    @Test func aFailedFetchSaysSoInExportWords() async throws {
        #expect(ExportText.fetchFailed == "Couldn't download a file. Try exporting again.")
        let root = TemporaryRoot()
        let store = try root.open()
        let tune = Tune(title: "Cluck Old Hen")
        try await store.write { writer in
            try writer.put(tune)
            try writer.put(UserTune(tuneID: tune.id, status: "learning"))
            try writer.put(Recording(tuneID: tune.id, source: "capture", addedAt: noon, state: "ready"))
        }
        // No engine, so the fetch fails as an offline one would.
        let model = ExportDataModel(exporter: .live(store, engine: nil), isOffline: { false })
        let following = Task { await model.followCounts() }
        defer { following.cancel() }
        #expect(try await poll { model.counts != nil })
        let run = try #require(model.start())
        await run.value
        #expect(model.failure == ExportText.fetchFailed)
        #expect(!model.isRunning)
    }

    @Test func offlineWithEverythingOnTheDeviceExportStillRuns() async throws {
        let gate = Gate()
        let model = ExportDataModel(
            exporter: Exporter(counts: countsOnce(2, 2), make: { _ in try await gate.wait() }), isOffline: { true })
        await model.followCounts()
        let run = try #require(model.start())
        await gate.finish(.success(try makeZip()))
        await run.value
        #expect(model.failure == nil)
        #expect(model.exported != nil)
        model.cancel()
    }

    @Test func onlineWithFilesToFetchExportRuns() async throws {
        let gate = Gate()
        let model = ExportDataModel(
            exporter: Exporter(counts: countsOnce(0, 2, missing: 2), make: { _ in try await gate.wait() }),
            isOffline: { false })
        await model.followCounts()
        let run = try #require(model.start())
        await gate.finish(.success(try makeZip()))
        await run.value
        #expect(model.exported != nil)
        model.cancel()
    }

    @Test func progressReadsCorrectlyForAnyTotal() {
        #expect(ExportDataSheet.progress(done: 1, total: 1) == "Preparing file 1 of 1")
        #expect(ExportDataSheet.progress(done: 4, total: 12) == "Preparing file 4 of 12")
    }

    @Test func countsFollowTheStoreWhileTheSheetIsOpen() async throws {
        let (updates, continuation) = AsyncThrowingStream.makeStream(of: ExportCounts.self)
        let model = ExportDataModel(exporter: Exporter(counts: { updates }, make: { _ in throw DiskFull() }))
        let following = Task { await model.followCounts() }

        continuation.yield(ExportCounts(onDevice: 1, total: 3, missing: 2))
        #expect(try await poll { model.counts != nil })
        #expect(model.counts == ExportCounts(onDevice: 1, total: 3, missing: 2))

        continuation.yield(ExportCounts(onDevice: 3, total: 3))
        #expect(try await poll { model.counts?.missing == 0 })
        #expect(model.counts == ExportCounts(onDevice: 3, total: 3))

        continuation.finish()
        await following.value
    }

    @Test func exportWaitsForCounts() async {
        let model = ExportDataModel(
            exporter: Exporter(
                counts: { AsyncThrowingStream { $0.finish(throwing: DiskFull()) } }, make: { _ in throw DiskFull() }))
        await model.followCounts()
        #expect(!model.canStart)
        #expect(model.failure == "The disk is full.")
        #expect(model.start() == nil)
    }

    @Test func aFinishedExportIsHandedOffAndDeletedOnceClosed() async throws {
        let gate = Gate()
        let model = await model(gate)
        let zip = try makeZip()
        let run = try #require(model.start())
        await gate.finish(.success(zip))
        await run.value
        #expect(model.exported == zip)
        #expect(!model.isRunning)
        model.finishHandOff()
        #expect(model.exported == nil)
        #expect(!exists(zip.deletingLastPathComponent()))
    }

    @Test func aSecondStartWhileRunningDoesNothing() async throws {
        let gate = Gate()
        let model = await model(gate)
        let run = try #require(model.start())
        #expect(model.start() == nil)
        let zip = try makeZip()
        await gate.finish(.success(zip))
        await run.value
        #expect(await gate.starts == 1)
        model.cancel()
    }

    @Test func aResultAfterCancelIsThrownAwayWithItsZip() async throws {
        let gate = Gate()
        let model = await model(gate)
        let zip = try makeZip()
        let run = try #require(model.start())
        model.cancel()
        #expect(!model.isRunning)
        await gate.finish(.success(zip))
        await run.value
        #expect(model.exported == nil)
        #expect(model.failure == nil)
        #expect(!exists(zip.deletingLastPathComponent()))
    }

    @Test func aFailureShowsAndAllowsAnotherTry() async throws {
        let gate = Gate()
        let model = await model(gate)
        let run = try #require(model.start())
        await gate.finish(.failure(DiskFull()))
        await run.value
        #expect(model.failure == "The disk is full.")
        #expect(!model.isRunning)
        #expect(model.canStart)
    }

    @Test func progressShowsWhileRunning() async throws {
        let gate = Gate()
        let model = ExportDataModel(
            exporter: Exporter(
                counts: countsOnce(2, 2),
                make: { progress in
                    progress(1, 2)
                    return try await gate.wait()
                }))
        await model.followCounts()
        let run = try #require(model.start())
        var turns = 0
        while model.progressText == nil, turns < 1000 {
            await Task.yield()
            turns += 1
        }
        #expect(model.progressText == ExportDataSheet.progress(done: 1, total: 2))
        await gate.finish(.success(try makeZip()))
        await run.value
        #expect(model.progressText == nil)
        model.cancel()
    }

    @Test func cancellingARunThatStopsLeavesNoFailure() async throws {
        let model = ExportDataModel(
            exporter: Exporter(
                counts: countsOnce(1, 1),
                make: { _ in
                    try await Task.sleep(for: .seconds(60))
                    throw DiskFull()
                }))
        await model.followCounts()
        let run = try #require(model.start())
        model.cancel()
        await run.value
        #expect(model.failure == nil)
        #expect(!model.isRunning)
        #expect(model.canStart)
    }

    @Test func aZipLeftWhenTheModelGoesIsDeleted() async throws {
        let gate = Gate()
        var model: ExportDataModel? = await self.model(gate)
        let zip = try makeZip()
        let run = try #require(model?.start())
        await gate.finish(.success(zip))
        await run.value
        #expect(model?.exported == zip)
        weak let gone = model
        model = nil
        for _ in 0..<1000 where gone != nil { await Task.yield() }
        #expect(gone == nil)
        #expect(!exists(zip.deletingLastPathComponent()))
    }

    @Test func cancellingDeletesAZipNotYetHandedOff() async throws {
        let gate = Gate()
        let model = await model(gate)
        let zip = try makeZip()
        let run = try #require(model.start())
        await gate.finish(.success(zip))
        await run.value
        model.cancel()
        #expect(model.exported == nil)
        #expect(!exists(zip.deletingLastPathComponent()))
    }
}

struct ExportZipTests {
    @Test func suggestsTheZipsName() {
        let zip = URL(filePath: "/tmp/crosstune-export-2026-10-16.zip")
        let provider = NSItemProvider()
        provider.register(ExportZip(url: zip))
        #expect(provider.suggestedName == zip.lastPathComponent)
    }
}

#if os(macOS)
    @MainActor
    @Suite struct MacExportSheetTests {
        /// The export note always names what the zip holds, as the subtitle; the body adds only
        /// what differs from it.
        @Test func exportNoteIsTheSubtitle() {
            #expect(ExportDataSheet.macBodyNote(ExportDataSheet.completeNote) == nil)
            #expect(ExportDataSheet.macBodyNote(nil) == nil)
            #expect(ExportDataSheet.macBodyNote("Needs a connection") == "Needs a connection")
        }
    }
#endif
