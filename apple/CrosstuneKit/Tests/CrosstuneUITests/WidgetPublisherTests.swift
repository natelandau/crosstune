import CrosstuneCommands
import CrosstuneRecording
import CrosstuneRecordingActivity
import CrosstuneShare
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneWidgetData
import Foundation
import Testing

@testable import CrosstuneUI

/// The app keeps the widget summary of the open store's user current, writing only what changed.
@MainActor
@Suite struct WidgetPublisherTests {
    private let root = TemporaryRoot()
    /// Each summary as it stood when the widgets were told to reload.
    private let reloads = ReloadLog()

    private var container: ShareContainer { ShareContainer(root: root.url.appending(path: "group")) }

    /// Runs a publisher over `store` with no recorder, list playback, or plan, until `body` ends.
    private func publishing(_ store: CrosstuneStore, _ body: () async throws -> Void) async throws {
        let (container, reloads, userID) = (container, reloads, store.userID)
        let publisher = WidgetPublisher(
            container: container, pageStore: nil,
            reload: { _ in reloads.summaries.append(WidgetSummaryFile.read(userID: userID, in: container)) })
        // At the app's priority: the app starts the run from the main thread, outside any task,
        // so it runs user-initiated. At a test's default priority, its reads and writes off the
        // main actor queue behind every other test in the bundle.
        let task = Task(priority: .userInitiated) {
            await publisher.run(store: store, recorders: RecorderHost(), listPlayback: nil, plan: nil)
        }
        defer { task.cancel() }
        try await body()
        task.cancel()
        await task.value
    }

    @Test func writesUnderTheStoresUserOnly() async throws {
        let store = try root.open("user_a")
        _ = try await Commands(store: store).createTitleOnly(title: "Drowsy Maggie")

        try await publishing(store) {
            try await eventually { WidgetSummaryFile.read(userID: "user_a", in: container) != nil }
        }

        #expect(WidgetSummaryFile.read(userID: "user_b", in: container) == nil)
    }

    @Test func writesTheRealRecordingAndListStateFirst() async throws {
        let store = try root.open()
        let leftover = WidgetSummary(
            recordingsPlay: true,
            recordings: [
                WidgetRecording(
                    id: "left", title: "Warm-up", isUnfiled: true, recordedAt: noon.date,
                    recordedPrecision: .time, duration: 60)
            ],
            lists: [], tunerReferenceLabel: nil,
            recording: RecordingActivityState(status: .recording, timerStart: noon.date, elapsed: 0, canResume: false),
            recordingFreshUntil: noon.date.addingTimeInterval(15),
            listPlayback: WidgetListPlayback(
                listID: "l1", currentTuneID: "t1", isPlaying: false, position: 1, count: 2, nextTuneID: "t2"))
        try WidgetSummaryFile.write(leftover, userID: store.userID, in: container)

        try await publishing(store) {
            try await eventually { !reloads.summaries.isEmpty }
        }

        let first = try #require(reloads.summaries.first ?? nil)
        #expect(first.recording == nil)
        #expect(first.listPlayback == nil)
        // Still the leftover's recordings, so nothing was written before the recorder's state.
        #expect(first.recordings.map(\.id) == ["left"])
    }

    /// A store closes on sign-out, so the widgets must read again and find no one signed in.
    @Test func reloadsWhenTheStoreCloses() async throws {
        let store = try root.open()
        var reloadsWhileOpen = 0

        try await publishing(store) {
            try await eventually { !reloads.summaries.isEmpty }
            reloadsWhileOpen = reloads.summaries.count
        }

        #expect(reloads.summaries.count == reloadsWhileOpen + 1)
    }

    @Test func anUnchangedValueDoesNotReload() async throws {
        let store = try root.open()
        let commands = Commands(store: store)
        let tune = try await commands.createTitleOnly(title: "Drowsy Maggie")

        try await publishing(store) {
            try await eventually { !reloads.summaries.isEmpty }
            // The composer is not in the summary, so this change writes nothing.
            try await commands.updateTune(tune.tuneID, patch: TunePatch(composer: .value("Traditional")))
            let list = try await commands.createList("Session")
            try await eventually { reloads.summaries.last??.lists.map(\.id) == [list] }
            #expect(reloads.summaries.count == 2)
        }
    }

    @Test func aRecordingStaysFreshOnlyWhileKeptAlive() throws {
        var draft = WidgetSummaryDraft(leftover: nil)
        draft.recordings = []
        draft.listsPart = WidgetListsPart(lists: [], tunerReferenceLabel: nil)
        let inputs = { (state: Recorder.State) in
            WidgetLiveInputs(recorder: snapshot(state, elapsed: 1), recordingsPlay: true, listPlayback: nil)
        }
        let start = noon.date
        let interval = WidgetPublisher.refreshInterval / .seconds(1)

        draft.observe(inputs(.recording), now: start)
        let started = try #require(draft.unwritten?.recordingFreshUntil)
        draft.keepAlive(now: start.addingTimeInterval(interval / 2))
        let early = draft.unwritten?.recordingFreshUntil
        draft.keepAlive(now: start.addingTimeInterval(interval))
        let kept = try #require(draft.unwritten?.recordingFreshUntil)
        draft.observe(inputs(.paused), now: start.addingTimeInterval(interval + 1))

        #expect(started > start)
        #expect(early == started)
        #expect(kept.timeIntervalSince(started) == interval)
        #expect(draft.unwritten?.recordingFreshUntil == nil)
    }

    /// A paused list and an interrupted or saving recording can sit unchanged while the app is
    /// suspended, so they never expire on the widget's clock.
    @Test(arguments: [Recorder.State.paused, .finishing, .idle])
    func aStateTheAppCanBeSuspendedInHasNoExpiry(recorder: Recorder.State) {
        var draft = WidgetSummaryDraft(leftover: nil)
        draft.recordings = []
        draft.listsPart = WidgetListsPart(lists: [], tunerReferenceLabel: nil)
        let paused = WidgetListPlayback(
            listID: "l1", currentTuneID: "t1", isPlaying: false, position: 1, count: 2, nextTuneID: "t2")

        draft.observe(
            WidgetLiveInputs(recorder: snapshot(recorder, elapsed: 1), recordingsPlay: true, listPlayback: paused),
            now: noon.date)

        #expect(draft.unwritten?.listPlayback == paused)
        #expect(draft.unwritten?.recordingFreshUntil == nil)
        #expect(!draft.isRecording)
    }

    @Test func theAppEndingClearsAPausedListAndAnInterruptedRecording() throws {
        let summary = WidgetSummary(
            recordingsPlay: true, recordings: [], lists: [], tunerReferenceLabel: nil,
            recording: RecordingActivityState(status: .interrupted, timerStart: nil, elapsed: 4, canResume: true),
            recordingFreshUntil: nil,
            listPlayback: WidgetListPlayback(
                listID: "l1", currentTuneID: "t1", isPlaying: false, position: 1, count: 2, nextTuneID: "t2"))
        try WidgetSummaryFile.write(summary, userID: "user_a", in: container)
        let (container, reloads) = (container, reloads)
        let publisher = WidgetPublisher(
            container: container, pageStore: nil,
            reload: { _ in reloads.summaries.append(WidgetSummaryFile.read(userID: "user_a", in: container)) })

        publisher.appWillEnd(userID: "user_a")

        let ended = try #require(WidgetSummaryFile.read(userID: "user_a", in: container))
        #expect(ended.listPlayback == nil)
        #expect(ended.recording == nil)
        #expect(reloads.summaries == [ended])
    }

    @Test func aRecordingsTimerTicksWriteNothing() throws {
        var draft = Self.draftWithParts()
        draft.observe(Self.inputs(snapshot(.recording, elapsed: 1)), now: noon.date)
        let started = try #require(draft.unwritten)
        draft.written = started

        draft.observe(Self.inputs(snapshot(.recording, elapsed: 2)), now: noon.date.addingTimeInterval(1))

        #expect(started.recording?.status == .recording)
        #expect(draft.unwritten == nil)
    }

    @Test(arguments: [true, false])
    func aSavedStateShowsOnlyWhenARecordingEnds(wasRecording: Bool) {
        var draft = Self.draftWithParts()
        if wasRecording { draft.observe(Self.inputs(snapshot(.recording, elapsed: 1)), now: noon.date) }

        let wait = draft.observe(Self.inputs(snapshot(.idle, elapsed: 5, savedRecordingID: "r1")), now: noon.date)
        let saved = draft.unwritten?.recording
        draft.dismissRecording(token: draft.recordingToken)

        #expect(saved?.status == (wasRecording ? .saved : nil))
        #expect((wait != nil) == wasRecording)
        #expect(draft.unwritten?.recording == nil)
    }

    /// Until the plan's first read lands, the widgets keep the plan they last showed.
    @Test func thePlanLastWrittenHoldsUntilThePlanLoads() {
        let leftover = WidgetSummary(
            recordingsPlay: false, recordings: [], lists: [], tunerReferenceLabel: nil, recording: nil,
            recordingFreshUntil: nil, listPlayback: nil)
        var draft = WidgetSummaryDraft(leftover: leftover)

        draft.observe(
            WidgetLiveInputs(recorder: snapshot(.idle, elapsed: 0), recordingsPlay: nil, listPlayback: nil),
            now: noon.date)
        let beforeLoad = draft.unwritten
        draft.observe(Self.inputs(snapshot(.idle, elapsed: 0)), now: noon.date)

        #expect(beforeLoad == nil)
        #expect(draft.unwritten?.recordingsPlay == true)
    }

    /// A draft with the store's parts read, so it has a summary to write.
    private static func draftWithParts() -> WidgetSummaryDraft {
        var draft = WidgetSummaryDraft(leftover: nil)
        draft.recordings = []
        draft.listsPart = WidgetListsPart(lists: [], tunerReferenceLabel: nil)
        return draft
    }

    private static func inputs(_ recorder: RecorderSnapshot) -> WidgetLiveInputs {
        WidgetLiveInputs(recorder: recorder, recordingsPlay: true, listPlayback: nil)
    }

    private func snapshot(_ state: Recorder.State, elapsed: TimeInterval, savedRecordingID: String? = nil)
        -> RecorderSnapshot
    {
        RecorderSnapshot(
            state: state, elapsed: elapsed, resumeAvailable: false, savedRecordingID: savedRecordingID,
            errorMessage: nil)
    }
}

@MainActor
private final class ReloadLog {
    var summaries: [WidgetSummary?] = []
}
