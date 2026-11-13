import CrosstuneExport
import Foundation
import Testing

@testable import CrosstuneUI

struct RecordingExportTextTests {
    @Test(arguments: [
        (
            1, 3,
            "1 of 3 recordings can't be exported. It is still recording, still processing, or not on this device while offline."
        ),
        (
            2, 5,
            "2 of 5 recordings can't be exported. They are still recording, still processing, or not on this device while offline."
        ),
    ])
    func theSkippedNoticeCountsInTheSingularAtOne(skipped: Int, selected: Int, notice: String) {
        #expect(RecordingExportText.skipped(skipped, of: selected) == notice)
    }

    @Test(arguments: [
        (1, "1 recording could not be downloaded and was left out."),
        (3, "3 recordings could not be downloaded and were left out."),
    ])
    func theLeftOutLineCountsInTheSingularAtOne(count: Int, line: String) {
        #expect(RecordingExportText.leftOut(count) == line)
    }
}

private func item(_ readiness: ExportReadiness) -> RecordingExportItem {
    RecordingExportItem(
        recordingID: UUID().uuidString,
        name: NameInput(title: "Reel", titleIsDate: false, recordedAt: nil, precision: nil, fileExtension: "m4a"),
        album: nil, readiness: readiness)
}

private let local = ExportReadiness.local(URL(filePath: "/tmp/reel.m4a"))

struct RecordingExportRequestTests {
    /// Recordings that cannot be exported are counted before the export starts, a single one
    /// says its own reason, and a selection with none left to export cannot go on.
    @Test(
        arguments: [
            ([local, .fetch], nil, true),
            ([.blocked(.capturing), .fetch, local], RecordingExportText.skipped(1, of: 3), true),
            ([.blocked(.offline), .blocked(.notReady)], RecordingExportText.skipped(2, of: 2), false),
            ([.blocked(.offline)], RecordingExportText.disabledReason(.blocked(.offline)), false),
        ] as [([ExportReadiness], String?, Bool)])
    func saysWhatItSkipsBeforeItStarts(readiness: [ExportReadiness], notice: String?, canContinue: Bool) {
        let request = RecordingExportRequest(items: readiness.map(item), delivery: .share, title: "Reels")
        #expect(request.skippedNotice == notice)
        #expect(request.canContinue == canContinue)
    }
}
