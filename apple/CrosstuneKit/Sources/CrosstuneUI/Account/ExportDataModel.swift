import CrosstuneExport
import CrosstuneStore
import Foundation
import OSLog
import Observation

/// What the export sheet reads and builds, apart from the store so a test can stand in for it.
struct Exporter: Sendable {
    /// The counts now and after every change, until the caller stops listening.
    var counts: @Sendable () -> AsyncThrowingStream<ExportCounts, any Error>
    var make: @Sendable (_ progress: @escaping @Sendable (Int, Int) -> Void) async throws -> URL

    static func live(_ store: CrosstuneStore) -> Exporter {
        Exporter(
            counts: { ExportArchive.counts(store: store) },
            make: { progress in
                try await ExportArchive.make(store: store, now: .now, timeZone: .current, progress: progress)
            })
    }
}

/// The export sheet's state: the recording counts, a running export and its progress, and the
/// zip once it is ready to hand off. Cancel abandons a run at any point, and a result that
/// arrives after it is thrown away along with its zip.
@MainActor
@Observable
final class ExportDataModel {
    struct Progress: Equatable, Sendable {
        var done: Int
        var total: Int
    }

    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "export")

    private let exporter: Exporter?

    private(set) var counts: ExportCounts?
    private(set) var progress: Progress?
    private(set) var failure: String?
    /// The finished zip, while the share sheet or save panel has it.
    private(set) var exported: URL?
    private(set) var isRunning = false

    private var run: Task<Void, Never>?
    /// Bumped by every start and cancel, so a run that finishes late can tell it was abandoned.
    private var generation = 0

    init(exporter: Exporter?) {
        self.exporter = exporter
    }

    /// The share sheet and save panel hold the model until they finish, so a zip still here
    /// once the sheet is gone has no one left to hand it to.
    isolated deinit {
        if let exported { Self.discard(exported) }
    }

    var note: String? {
        counts.map { ExportDataSheet.note(onDevice: $0.onDevice, total: $0.total) }
    }

    var progressText: String? {
        guard isRunning, let progress, progress.total > 0 else { return nil }
        return ExportDataSheet.progress(done: progress.done, total: progress.total)
    }

    var canStart: Bool {
        exporter != nil && counts != nil && !isRunning && exported == nil
    }

    /// Keeps the counts current until the caller is cancelled, so the note follows downloads
    /// that land while the sheet is open.
    func followCounts() async {
        guard let exporter else { return }
        do {
            for try await update in exporter.counts() { counts = update }
        } catch {
            Self.logger.error("Could not count recordings to export: \(error, privacy: .public)")
            failure = error.localizedDescription
        }
    }

    /// Starts an export unless one is running or waiting to be handed off. Returns the run so a
    /// test can wait on it.
    @discardableResult
    func start() -> Task<Void, Never>? {
        guard canStart, let exporter else { return nil }
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
            } catch {
                guard mine == generation else { return }
                Self.logger.error("Could not export: \(error, privacy: .public)")
                failure = error.localizedDescription
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
