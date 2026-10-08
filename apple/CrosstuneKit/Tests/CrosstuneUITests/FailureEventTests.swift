import CrosstuneAnalytics
import CrosstuneExport
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private struct DiskFull: Error {
    let text = "Disk full at /Users/someone/Music/Take 1.m4a"
}

/// A failed export reports its kind of reason and never the error's text, and the delete account
/// sheet reports being opened and, when it closes without deleting, being cancelled.
@MainActor
@Suite struct FailureEventTests {
    private let sink = RecordingAnalyticsSink()

    private func exportFailing(with error: any Error) async throws -> ExportDataModel {
        let model = ExportDataModel(
            exporter: Exporter(
                counts: {
                    AsyncThrowingStream { continuation in
                        continuation.yield(ExportCounts(onDevice: 1, total: 1))
                        continuation.finish()
                    }
                },
                make: { _ in throw error }),
            analytics: sink.client)
        await model.followCounts()
        return model
    }

    @Test func anExportErrorReportsItsReason() async throws {
        let model = try await exportFailing(with: CocoaError(.fileWriteOutOfSpace))
        let run = try #require(model.start())
        await run.value

        let other = try await exportFailing(with: DiskFull())
        let otherRun = try #require(other.start())
        await otherRun.value

        #expect(
            sink.captures == [
                .init(
                    name: "export_failed",
                    properties: ["format": .string("zip"), "failure_reason": .string("storage_full")]),
                .init(
                    name: "export_failed", properties: ["format": .string("zip"), "failure_reason": .string("other")]),
            ])
    }

    @Test func anExportThatSucceedsOrIsCancelledReportsNoFailure() async throws {
        let model = try await exportFailing(with: CancellationError())
        let run = try #require(model.start())
        model.cancel()
        await run.value

        #expect(sink.captures.isEmpty)
    }

    @Test func openingAndCancellingDeletionReportsEach() {
        var visit = AccountDeletionVisit()

        visit.opened(sink.client)
        visit.opened(sink.client)
        visit.closed(sink.client)

        #expect(sink.captures.map(\.name) == ["account_deletion_started", "account_deletion_cancelled"])
    }

    @Test func confirmingDeletionReportsNoCancel() {
        var visit = AccountDeletionVisit()

        visit.opened(sink.client)
        visit.confirmed()
        visit.closed(sink.client)

        #expect(sink.captures.map(\.name) == ["account_deletion_started"])
    }

    @Test func aRefusedDeletionThatIsThenClosedIsACancel() {
        var visit = AccountDeletionVisit()

        visit.opened(sink.client)
        visit.confirmed()
        visit.failed()
        visit.closed(sink.client)

        #expect(sink.captures.map(\.name) == ["account_deletion_started", "account_deletion_cancelled"])
    }

    @Test func aSheetThatNeverOpenedReportsNoCancel() {
        var visit = AccountDeletionVisit()

        visit.closed(sink.client)

        #expect(sink.calls.isEmpty)
    }
}
