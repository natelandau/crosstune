import CrosstuneRecordingActivity
import CrosstuneShare
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneWidgetData

struct WidgetSummaryTests {
    let root = TemporaryRoot()

    private static let summary = WidgetSummary(
        recordingsPlay: true,
        recordings: [
            WidgetRecording(
                id: "r1", title: "Drowsy Maggie", isUnfiled: false,
                recordedAt: Date(timeIntervalSince1970: 1_700_000_000),
                recordedPrecision: .day, duration: 93)
        ],
        lists: [
            WidgetList(
                id: "l1", name: "Session",
                tunes: [WidgetListTune(id: "t1", title: "Kesh", detail: "D · Reel · AEAE")])
        ],
        tunerReferenceLabel: "A4 = 442 Hz",
        recording: RecordingActivityState(status: .recording, timerStart: nil, elapsed: 4, canResume: false),
        recordingFreshUntil: Date(timeIntervalSince1970: 1_700_000_015),
        listPlayback: WidgetListPlayback(
            listID: "l1", currentTuneID: "t1", isPlaying: true, position: 1, count: 1, nextTuneID: nil)
    )

    @Test func summaryRoundTripsThroughTheFile() throws {
        let container = ShareContainer(root: try root.folder())
        try WidgetSummaryFile.write(Self.summary, userID: "user_a", in: container)
        #expect(WidgetSummaryFile.read(userID: "user_a", in: container) == Self.summary)
    }

    enum FileState: Sendable { case written, missing, undecodable }

    /// A signed-in user whose summary cannot be read is never shown as signed out.
    @Test(arguments: [
        (FileState.written, true), (.written, false), (.missing, true), (.undecodable, true),
    ])
    func readCurrentTellsSignedOutFromUnreadable(file: FileState, signedIn: Bool) throws {
        let container = ShareContainer(root: try root.folder())
        switch file {
        case .written: try WidgetSummaryFile.write(Self.summary, userID: "user_a", in: container)
        case .missing: break
        case .undecodable:
            let folder = container.userFolder("user_a")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try Data("{\"recordingsPlay\": \"yes\"}".utf8).write(to: folder.appending(path: "widgets.json"))
        }
        if signedIn { try container.setCurrentUserID("user_a") }

        let expected: CurrentWidgetSummary =
            switch (signedIn, file) {
            case (false, _): .signedOut
            case (true, .written): .available(Self.summary)
            case (true, .missing), (true, .undecodable): .unavailable
            }
        #expect(WidgetSummaryFile.readCurrent(in: container) == expected)
    }

    /// A file an older app wrote, before a field was added, still reads.
    @Test func aFileMissingLaterFieldsDecodesWithDefaults() throws {
        let json = Data(#"{"recordingsPlay": true}"#.utf8)
        let summary = try JSONDecoder().decode(WidgetSummary.self, from: json)
        #expect(
            summary
                == WidgetSummary(
                    recordingsPlay: true, recordings: [], lists: [], tunerReferenceLabel: nil, recording: nil,
                    recordingFreshUntil: nil, listPlayback: nil))
    }

    @Test func readIsNilForAUserWithNoFile() throws {
        let container = ShareContainer(root: try root.folder())
        #expect(WidgetSummaryFile.read(userID: "user_b", in: container) == nil)
    }

    @Test func removingTheUserRemovesTheSummary() throws {
        let container = ShareContainer(root: try root.folder())
        try WidgetSummaryFile.write(Self.summary, userID: "user_a", in: container)
        try container.removeUser("user_a")
        #expect(WidgetSummaryFile.read(userID: "user_a", in: container) == nil)
    }
}
