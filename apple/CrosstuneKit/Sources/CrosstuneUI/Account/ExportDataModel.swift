import CrosstuneAnalytics
import CrosstuneExport
import CrosstuneStore
import CrosstuneSync
import Foundation
import OSLog
import Observation

/// What the export sheet reads and builds, apart from the store so a test can stand in for it.
struct Exporter: Sendable {
    /// The counts now and after every change, until the caller stops listening.
    var counts: @Sendable () -> AsyncThrowingStream<ExportCounts, any Error>
    var make: @Sendable (_ progress: @escaping @Sendable (Int, Int) -> Void) async throws -> URL

    /// Fetches the files this device does not hold through `engine`; without one there is no
    /// connection to fetch them over.
    static func live(_ store: CrosstuneStore, engine: SyncEngine?) -> Exporter {
        let fetchMissing: FetchMissing = { file, destination in
            do {
                guard let engine else { throw URLError(.notConnectedToInternet) }
                switch file {
                case .recording(let id): try await engine.fetchRecordingCopy(id, to: destination)
                case .scan(let id): try await engine.fetchScanCopy(id, to: destination)
                }
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                throw ExportFetchFailed(underlying: error)
            }
        }
        return Exporter(
            counts: { ExportArchive.counts(store: store) },
            make: { progress in
                try await ExportArchive.make(
                    store: store, now: .now, timeZone: .current, fetchMissing: fetchMissing, progress: progress)
            })
    }
}

/// A file the device does not hold could not be fetched for the export.
struct ExportFetchFailed: LocalizedError {
    let underlying: any Error

    var errorDescription: String? { ExportText.fetchFailed }
}

/// The export sheet's state: the file counts, a running export and its progress, and the zip
/// once it is ready to hand off. Offline, an export that would fetch files says so in its note
/// and is refused on tap. Cancel abandons a run at any point, and a result that arrives after it
/// is thrown away along with its zip.
@MainActor
@Observable
final class ExportDataModel {
    struct Progress: Equatable, Sendable {
        var done: Int
        var total: Int
    }

    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "export")

    private let exporter: Exporter?
    private let isOffline: @MainActor () -> Bool
    private let analytics: AnalyticsClient

    private(set) var counts: ExportCounts?
    private(set) var progress: Progress?
    private(set) var failure: String?
    /// The finished zip, while the share sheet or save panel has it.
    private(set) var exported: URL?
    private(set) var isRunning = false

    private var run: Task<Void, Never>?
    /// Bumped by every start and cancel, so a run that finishes late can tell it was abandoned.
    private var generation = 0

    init(
        exporter: Exporter?, isOffline: @escaping @MainActor () -> Bool = { false }, analytics: AnalyticsClient = .noop
    ) {
        self.exporter = exporter
        self.isOffline = isOffline
        self.analytics = analytics
    }

    /// The share sheet and save panel hold the model until they finish, so a zip still here
    /// once the sheet is gone has no one left to hand it to.
    isolated deinit {
        if let exported { Self.discard(exported) }
    }

    /// The needs-connection copy while offline with files to fetch, so the sheet follows
    /// connectivity and the refused tap needs no message of its own.
    var note: String? {
        guard let counts else { return nil }
        return counts.missing > 0 && isOffline()
            ? ExportText.needsConnection(missing: counts.missing) : ExportDataSheet.completeNote
    }

    var progressText: String? {
        guard isRunning, let progress, progress.total > 0 else { return nil }
        return ExportDataSheet.progress(done: progress.done, total: progress.total)
    }

    var canStart: Bool {
        exporter != nil && counts != nil && !isRunning && exported == nil
    }

    /// Keeps the counts current until the caller is cancelled, so what an export must fetch
    /// follows downloads that land while the sheet is open.
    func followCounts() async {
        guard let exporter else { return }
        do {
            for try await update in exporter.counts() { counts = update }
        } catch {
            Self.logger.error("Could not count files to export: \(error, privacy: .public)")
            failure = failureMessage(error)
        }
    }

    /// Starts an export unless one is running or waiting to be handed off, or it must fetch
    /// files while the device is offline. Returns the run so a test can wait on it.
    @discardableResult
    func start() -> Task<Void, Never>? {
        guard canStart, let exporter, let counts else { return nil }
        if counts.missing > 0, isOffline() { return nil }
        generation += 1
        let mine = generation
        failure = nil
        progress = nil
        isRunning = true
        let (updates, continuation) = AsyncStream.makeStream(of: Progress.self, bufferingPolicy: .bufferingNewest(1))
        let task = Task {
            let watcher = Task {
                for await update in updates where mine == generation { progress = update }
            }
            defer {
                continuation.finish()
                watcher.cancel()
            }
            do {
                let url = try await exporter.make { done, total in
                    continuation.yield(Progress(done: done, total: total))
                }
                guard mine == generation else { return Self.discard(url) }
                exported = url
                analytics.send(.exportCompleted(format: .zip))
            } catch {
                guard mine == generation else { return }
                Self.logger.error("Could not export: \(error, privacy: .public)")
                failure = failureMessage(error)
                let cause = (error as? ExportFetchFailed)?.underlying ?? error
                analytics.send(.exportFailed(format: .zip, reason: FailureReason(cause)))
            }
            isRunning = false
            run = nil
        }
        run = task
        return task
    }

    /// Abandons a running export and deletes a zip not yet handed off.
    func cancel() {
        abandonRun()
        if let exported { Self.discard(exported) }
        exported = nil
    }

    /// Abandons a running export but leaves a finished zip to the share sheet or save panel
    /// that has it.
    func abandonRun() {
        generation += 1
        run?.cancel()
        run = nil
        isRunning = false
        progress = nil
    }

    /// The share sheet or save panel closed, done or not, so the zip is no longer needed.
    func finishHandOff() {
        if let exported { Self.discard(exported) }
        exported = nil
    }

    /// Deletes the zip's own folder, which holds nothing else.
    private static func discard(_ zip: URL) {
        try? FileManager.default.removeItem(at: zip.deletingLastPathComponent())
    }
}
