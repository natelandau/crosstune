import CrosstuneAnalytics
import CrosstuneDiagnostics
import CrosstuneExport
import CrosstuneStore
import CrosstuneSync
import Foundation
import Observation

/// What the export sheet reads and builds, apart from the store so a test can replace it.
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
    private let exporter: Exporter?
    private let isOffline: @MainActor () -> Bool
    private let analytics: AnalyticsClient
    private let run: ExportRun<URL>

    private(set) var counts: ExportCounts?
    private(set) var failure: String?

    init(
        exporter: Exporter?, isOffline: @escaping @MainActor () -> Bool = { false }, analytics: AnalyticsClient = .noop,
        diagnostics: DiagnosticsClient = .noop
    ) {
        self.exporter = exporter
        self.isOffline = isOffline
        self.analytics = analytics
        run = ExportRun(diagnostics: diagnostics, discard: Self.discard)
    }

    var progress: ExportProgress? { run.progress }
    /// The finished zip, while the share sheet or save panel has it.
    var exported: URL? { run.output }
    var isRunning: Bool { run.isRunning }

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

    /// Whether the files to export are counted, so Export can take a press. It stays true while
    /// an export runs and while its zip is handed off, so the button never reads as disabled
    /// under its working state or its check.
    var isReady: Bool {
        exporter != nil && counts != nil
    }

    var canStart: Bool {
        isReady && run.canStart
    }

    /// Keeps the counts current until the caller is cancelled, so what an export must fetch
    /// follows downloads that land while the sheet is open.
    func followCounts() async {
        guard let exporter else { return }
        do {
            for try await update in exporter.counts() { counts = update }
        } catch {
            exportLogger.error("Could not count files to export: \(error, privacy: .public)")
            failure = failureMessage(error)
        }
    }

    /// Starts an export unless one is running or waiting to be handed off, or it must fetch
    /// files while the device is offline. Returns the run so a test can wait on it.
    @discardableResult
    func start() -> Task<Void, Never>? {
        guard canStart, let exporter, let counts else { return nil }
        if counts.missing > 0, isOffline() { return nil }
        failure = nil
        return run.start(
            { progress in try await exporter.make(progress) },
            accept: { [analytics] _ in
                analytics.send(.exportCompleted(format: .zip))
                return true
            },
            failed: { [weak self] error, reason in
                self?.failure = failureMessage(error)
                self?.analytics.send(.exportFailed(format: .zip, reason: reason))
            })
    }

    /// Abandons a running export and deletes a zip not yet handed off.
    func cancel() {
        run.cancel()
    }

    /// Abandons a running export but leaves a finished zip to the share sheet or save panel
    /// that has it.
    func abandonRun() {
        run.abandon()
    }

    /// The share sheet or save panel closed, done or not, so the zip is no longer needed.
    func finishHandOff() {
        run.discardOutput()
    }

    /// Deletes the zip's own folder, which holds nothing else.
    private static func discard(_ zip: URL) {
        try? FileManager.default.removeItem(at: zip.deletingLastPathComponent())
    }
}
