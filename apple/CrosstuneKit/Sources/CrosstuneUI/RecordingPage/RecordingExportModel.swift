import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneDiagnostics
import CrosstuneExport
import CrosstuneStore
import CrosstuneSync
import Foundation
import Observation

/// One or more recordings to export, with what each needs fixed as the sheet opens, and how the
/// platform takes the files.
struct RecordingExportRequest: Identifiable {
    enum Delivery: Sendable {
        /// The share sheet, or on the Mac the share picker with the one file.
        case share
        /// Mac: a save panel with the one file's name filled in.
        case saveFile
        /// Mac: a folder picker, then every file written into that folder.
        case saveIntoFolder
    }

    let id = UUID()
    let items: [RecordingExportItem]
    let delivery: Delivery
    /// The sheet's title while it prepares the files.
    let title: String

    var method: RecordingExportMethod { delivery == .share ? .share : .save }

    /// How many recordings cannot be exported now, which the export skips.
    var blocked: Int {
        items.count(where: \.readiness.isBlocked)
    }

    /// What the sheet says before it starts, when it leaves some recordings out: one
    /// recording's own reason, or how many of several are skipped.
    var skippedNotice: String? {
        if items.count == 1, let reason = RecordingExportText.disabledReason(items[0].readiness) { return reason }
        return blocked > 0 ? RecordingExportText.skipped(blocked, of: items.count) : nil
    }

    var canContinue: Bool { blocked < items.count }
}

extension RecordingExportRequest {
    /// `rows`' recording alone, titled as its page titles it.
    init(_ rows: ScreenRows, readiness: ExportReadiness, delivery: Delivery) {
        self.init(
            items: [RecordingExportItem(rows.view, readiness: readiness)], delivery: delivery,
            title: RecordingText.title(rows.recording, tuneTitle: rows.tuneTitle))
    }
}

extension RecordingExportRequest.Delivery {
    /// One recording's export where nothing asks for Share: a save panel on the Mac, and the
    /// share sheet elsewhere.
    static var oneRecording: Self {
        #if os(macOS)
            .saveFile
        #else
            .share
        #endif
    }
}

/// Exports recordings: says first which it leaves out, then names, fetches, and tags the rest into
/// a temporary folder, and holds the files while the platform's hand-off has them. Cancel abandons
/// a run at any point, and a result that arrives after it is thrown away with its folder.
@MainActor
@Observable
final class RecordingExportModel {
    typealias Prepare =
        @Sendable (_ items: [RecordingExportItem], _ progress: @escaping @Sendable (Int, Int) -> Void) async throws ->
        RecordingExportResult
    /// Puts the prepared files into the folder the musician picked.
    typealias Write = @Sendable (_ files: [URL], _ folder: URL) async throws -> Void

    enum Stage: Equatable {
        /// Before the run, with what it leaves out until the musician goes on.
        case notStarted(notice: String?)
        case preparing
        /// The files wait on the platform. `asking` while its save panel or folder picker should
        /// show; a closed panel clears only `asking`, since the save may still be copying the file.
        case handingOff(asking: Bool)
        /// The files are going into the picked folder, which finishes or fails as a whole.
        case writing
        /// The run, the save, or the write failed. A failed save or write keeps the files.
        case failed(String)
        /// Cancelled or handed off.
        case ended
    }

    /// How a hand-off ended.
    enum HandOffEnd: Equatable {
        /// The platform took the files. `leftOut` says how many recordings failed to download.
        case delivered(leftOut: String?)
        case backedOut
    }

    let request: RecordingExportRequest
    private(set) var stage: Stage

    private let prepare: Prepare
    private let writeFiles: Write
    private let analytics: AnalyticsClient
    private let run: ExportRun<RecordingExportResult>

    init(
        request: RecordingExportRequest, prepare: @escaping Prepare, write: @escaping Write,
        analytics: AnalyticsClient = .noop, diagnostics: DiagnosticsClient = .noop
    ) {
        self.request = request
        stage = .notStarted(notice: request.skippedNotice)
        self.prepare = prepare
        writeFiles = write
        self.analytics = analytics
        run = ExportRun(diagnostics: diagnostics, discard: RecordingExport.discard)
    }

    /// Fetches what the device does not hold through `engine`; without one there is no connection
    /// to fetch it over.
    convenience init(
        request: RecordingExportRequest, engine: SyncEngine?, analytics: AnalyticsClient, diagnostics: DiagnosticsClient
    ) {
        let fetch: FetchRecording = { recordingID, destination in
            guard let engine else { throw URLError(.notConnectedToInternet) }
            try await engine.fetchRecordingCopy(recordingID, to: destination)
        }
        self.init(
            request: request,
            prepare: { items, progress in
                try await RecordingExport.prepare(items, timeZone: .current, fetch: fetch, progress: progress)
            },
            write: { files, folder in try await Self.writeIntoFolder(files, folder) }, analytics: analytics,
            diagnostics: diagnostics)
    }

    /// The prepared files, while the platform's hand-off has them.
    var prepared: RecordingExportResult? { run.output }

    var notice: String? {
        if case .notStarted(let notice) = stage { notice } else { nil }
    }

    var failure: String? {
        if case .failed(let failure) = stage { failure } else { nil }
    }

    /// Whether the export is under way, so the sheet shows progress and holds open.
    var isBusy: Bool { stage == .preparing || stage == .writing }

    /// Whether the save panel or folder picker should show.
    var isAsking: Bool { stage == .handingOff(asking: true) }

    /// The file being prepared, counted from one, as the Settings export words it.
    var progressText: String? {
        guard let progress = run.progress, progress.total > 0 else { return nil }
        return ExportDataSheet.progress(done: min(progress.done + 1, progress.total), total: progress.total)
    }

    /// Starts the export as the sheet opens, unless it first says what it leaves out.
    func open() {
        if stage == .notStarted(notice: nil) { start() }
    }

    /// Prepares the files, from before the run or after a failed one. Returns the run so a test
    /// can wait on it.
    @discardableResult
    func start() -> Task<Void, Never>? {
        switch stage {
        case .notStarted, .failed: break
        default: return nil
        }
        guard run.canStart else { return nil }
        stage = .preparing
        let (prepare, items) = (prepare, request.items)
        return run.start(
            { progress in try await prepare(items, progress) },
            accept: { [weak self] result in
                // Every recording's download failed, so there is nothing to hand off.
                guard !result.files.isEmpty else {
                    self?.stage = .failed(RecordingText.downloadFailed)
                    return false
                }
                self?.stage = .handingOff(asking: true)
                return true
            },
            failed: { [weak self] error, _ in self?.stage = .failed(failureMessage(error)) })
    }

    /// After a failure: asks where to put the files again when a failed save or write kept
    /// them, or else prepares them again.
    func retry() {
        guard case .failed = stage else { return }
        if prepared != nil {
            stage = .handingOff(asking: true)
        } else {
            start()
        }
    }

    /// The save panel or folder picker closed. The files wait for its completion.
    func stopAsking() {
        if isAsking { stage = .handingOff(asking: false) }
    }

    /// The save panel could not save the file. The failure shows and the file stays, so another
    /// try only opens the panel again.
    func saveFailed(_ error: any Error) {
        guard case .handingOff = stage, prepared != nil else { return }
        exportLogger.error("Could not save the exported recording: \(error, privacy: .public)")
        stage = .failed(failureMessage(error))
    }

    /// Abandons a running preparation and deletes files not yet handed off.
    func cancel() {
        run.cancel()
        stage = .ended
    }

    /// Abandons a running preparation but leaves prepared files to the hand-off that has them.
    func abandonRun() {
        run.abandon()
        if stage == .preparing { stage = .ended }
    }

    /// The hand-off closed, so the files are no longer needed. `delivered` says the platform took
    /// them, rather than the musician backing out. Nil when no files wait on a hand-off.
    @discardableResult
    func finishHandOff(delivered: Bool) -> HandOffEnd? {
        guard let prepared else { return nil }
        if delivered { Self.report(prepared, method: request.method, analytics: analytics) }
        run.discardOutput()
        stage = .ended
        return delivered ? .delivered(leftOut: Self.leftOutLine(prepared)) : .backedOut
    }

    /// Gives the prepared files to a service that reads them after the sheet has gone. The model
    /// lets go of them, and the returned closure, which holds only the files, reports the delivery
    /// and deletes them once the service is done.
    func detachHandOff() -> (@MainActor () -> Void)? {
        guard let prepared = run.takeOutput() else { return nil }
        stage = .ended
        let (analytics, method) = (analytics, request.method)
        return {
            Self.report(prepared, method: method, analytics: analytics)
            RecordingExport.discard(prepared)
        }
    }

    /// Writes the prepared files into `folder`, or lets them go when no folder was picked. Nil
    /// while the hand-off goes on: after a failed write the files stay for another try.
    func write(into folder: URL?) async -> HandOffEnd? {
        guard case .handingOff = stage, let prepared else { return nil }
        guard let folder else { return finishHandOff(delivered: false) }
        stage = .writing
        do {
            try await writeFiles(prepared.files, folder)
        } catch {
            exportLogger.error("Could not write exported recordings: \(error, privacy: .public)")
            stage = .failed(failureMessage(error))
            return nil
        }
        return finishHandOff(delivered: true)
    }

    /// The line for the end of the export, when downloads failed. Recordings blocked up front
    /// were told before the start.
    private static func leftOutLine(_ result: RecordingExportResult) -> String? {
        result.failed > 0 ? RecordingExportText.leftOut(result.failed) : nil
    }

    private static func report(
        _ result: RecordingExportResult, method: RecordingExportMethod, analytics: AnalyticsClient
    ) {
        analytics.send(
            .recordingExported(
                method: method, count: result.files.count, fetched: result.fetched, skipped: result.skipped))
    }

    @concurrent
    private nonisolated static func writeIntoFolder(_ files: [URL], _ folder: URL) async throws {
        let scoped = folder.startAccessingSecurityScopedResource()
        defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
        _ = try RecordingExport.writeIntoFolder(files, folder: folder)
    }
}

extension ExportReadiness {
    /// What exporting `view` needs. Only the recording's own capture blocks it, and the plan
    /// never does. A fetch needs `engine` and a session that is not offline.
    @MainActor init(_ view: RecordingView, store: CrosstuneStore?, engine: SyncEngine?, session: AccountSession?) {
        self = exportReadiness(
            state: view.recording.state, localFile: store?.currentLocalAudio(view.recording, file: view.file),
            isCapturing: view.file?.localState == .capturing, online: engine != nil && session?.isOffline != true)
    }
}

extension RecordingExportItem {
    /// `view`'s recording, named by the title its rows show with no tune named above, and with
    /// its tune's title as the album.
    init(_ view: RecordingView, readiness: ExportReadiness) {
        let recording = view.recording
        let recorded = recording.knownRecordedDate
        self.init(
            recordingID: recording.id,
            name: NameInput(
                title: RecordingText.title(recording, tuneTitle: view.tuneTitle),
                titleIsDate: RecordingText.titleIsDate(recording, tuneTitle: view.tuneTitle),
                recordedAt: recorded?.at.date, precision: recorded?.precision,
                fileExtension: playbackFileExtension(recording.playbackMime)),
            album: view.tuneTitle, readiness: readiness)
    }
}
