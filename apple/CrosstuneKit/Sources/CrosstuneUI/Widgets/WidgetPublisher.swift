import CrosstuneCommands
import CrosstuneRecordingActivity
import CrosstuneShare
import CrosstuneStore
import CrosstuneWidgetData
import CrosstuneWidgetIntents
import Foundation
import GRDB
import os

#if os(iOS)
    import UIKit
    import WidgetKit
#endif

/// Keeps the signed-in user's widget summary current: the store's recordings, lists, and tuner
/// pitch, with the plan, the recorder, and list playback as they change.
@MainActor
public final class WidgetPublisher {
    /// How long a written recording stays current. Past it, the widget shows that nothing is
    /// recording, which covers the app ending with no chance to write again.
    nonisolated static let freshness: Duration = .seconds(120)
    /// How often the fresh-until date moves ahead while recording. Each move is a write and a
    /// widget reload, which WidgetKit budgets, so it is far rarer than the Live Activity's.
    nonisolated static let refreshInterval: Duration = .seconds(60)
    /// How long a change to the store's recordings or lists waits before it is written, so a
    /// burst of changes, such as a sync, writes and reloads the widgets once.
    nonisolated static let catalogDelay: Duration = .milliseconds(300)

    private let container: ShareContainer
    private let pageStore: ListWidgetPageStore?
    private let reload: @MainActor (Set<WidgetKind>) -> Void
    nonisolated private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "widget-publisher")

    /// - Parameters:
    ///   - pageStore: The List widgets' pages, of which a deleted list's are dropped on each write.
    ///   - reload: Called with the kinds that show what changed after each write, and with every
    ///     kind when a run ends, so the widgets read the new summary or the signed-in user's change.
    public init(
        container: ShareContainer, pageStore: ListWidgetPageStore?,
        reload: @escaping @MainActor (Set<WidgetKind>) -> Void
    ) {
        self.container = container
        self.pageStore = pageStore
        self.reload = reload
    }

    #if os(iOS)
        /// A publisher on the App Group's folder, or nil in a build without the App Group.
        public static func appGroup() -> WidgetPublisher? {
            ShareContainer.appGroup().map {
                WidgetPublisher(
                    container: $0, pageStore: .appGroup(),
                    reload: { kinds in
                        for kind in kinds { WidgetCenter.shared.reloadTimelines(ofKind: kind.rawValue) }
                    })
            }
        }
    #endif

    /// Writes `store`'s summary under its user on each change, until the calling task is
    /// cancelled.
    public func run(store: CrosstuneStore, recorders: RecorderHost, listPlayback: ListPlayback?, plan: PlanModel?) async
    {
        let userID = store.userID
        var draft = WidgetSummaryDraft(leftover: await Self.read(userID: userID, in: container))
        draft.observe(
            Self.liveInputs(store: store, recorders: recorders, listPlayback: listPlayback, plan: plan), now: .now)
        // A summary an earlier run left can say a recording is under way or a list plays. The
        // recorder's and the list player's real state replaces it before anything else, so a
        // widget never shows either after it ended.
        await write(&draft, userID: userID)
        #if os(iOS)
            // A force-quit ends the app with no later write. The app can also sit suspended for
            // any time with a list paused or a recording interrupted, so those states have no
            // expiry and are cleared here instead.
            let termination = NotificationCenter.default.addObserver(
                forName: UIApplication.willTerminateNotification, object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.appWillEnd(userID: userID) }
            }
            defer { NotificationCenter.default.removeObserver(termination) }
        #endif

        let (changes, continuation) = AsyncStream.makeStream(of: WidgetSummaryChange.self)
        let (database, settingsRow) = (store.database, settingsID(clerkUserID: userID))
        let recordings = Task(priority: .utility) {
            await Self.follow(database, into: continuation) { db in
                .recordings(try WidgetSummaryReader.newestRecordings(db))
            }
        }
        let lists = Task(priority: .utility) {
            await Self.follow(database, into: continuation) { db in
                .lists(try WidgetSummaryReader.listsPart(db, settingsRow: settingsRow))
            }
        }
        let live = Task {
            // A running recording's timer counts on the widget by itself, so its elapsed time is
            // left out of what wakes this loop, and each wake reads the inputs whole.
            let wakes = Observations {
                Self.liveInputs(
                    store: store, recorders: recorders, listPlayback: listPlayback, plan: plan,
                    readsRunningElapsed: false)
            }
            for await _ in wakes {
                continuation.yield(
                    .live(Self.liveInputs(store: store, recorders: recorders, listPlayback: listPlayback, plan: plan)))
            }
        }
        var dismissal: Task<Void, Never>?
        var keepingAlive: Task<Void, Never>?
        var catalogWrite: Task<Void, Never>?
        /// Writes once ``catalogDelay`` has passed, with every catalog change made by then.
        func writeCatalogLater() {
            guard catalogWrite == nil else { return }
            catalogWrite = Task {
                guard (try? await Task.sleep(for: Self.catalogDelay)) != nil else { return }
                continuation.yield(.catalogSettled)
            }
        }
        // Ends when the calling task is cancelled, which ends the stream.
        for await change in changes {
            switch change {
            case .recordings(let part):
                draft.recordings = part
                writeCatalogLater()
                continue
            case .lists(let part):
                draft.listsPart = part
                writeCatalogLater()
                continue
            case .catalogSettled: catalogWrite = nil
            case .live(let input):
                if let wait = draft.observe(input, now: .now) {
                    dismissal?.cancel()
                    let token = draft.recordingToken
                    dismissal = Task {
                        guard (try? await Task.sleep(for: wait)) != nil else { return }
                        continuation.yield(.recordingDismissed(token: token))
                    }
                }
            case .recordingDismissed(let token): draft.dismissRecording(token: token)
            case .keepAlive: draft.keepAlive(now: .now)
            }
            if !draft.isRecording {
                keepingAlive?.cancel()
                keepingAlive = nil
            } else if keepingAlive == nil {
                keepingAlive = Task {
                    // Checks twice per interval, so a check that lands a moment early never
                    // doubles the time between refreshes.
                    while (try? await Task.sleep(for: Self.refreshInterval / 2)) != nil {
                        continuation.yield(.keepAlive)
                    }
                }
            }
            await write(&draft, userID: userID)
        }
        for task in [recordings, lists, live] + [dismissal, keepingAlive, catalogWrite].compactMap(\.self) {
            task.cancel()
            await task.value
        }
        // The store closed, as on sign-out, so the widgets read again and stop showing its user.
        reload(Set(WidgetKind.allCases))
    }

    /// Clears what the widgets must not show once the app has ended
    /// (``WidgetSummary/afterAppEnded``). Synchronous, because the app ends as soon as it returns.
    func appWillEnd(userID: String) {
        rewrite(userID: userID) { $0.afterAppEnded }
    }

    /// Clears a list playback from the signed-in user's summary. Call it when a widget's Pause
    /// or Resume finds no list playback in the app, which a summary written before the app was
    /// ended while suspended can still show.
    func clearListPlayback() {
        guard let userID = container.currentUserID() else { return }
        rewrite(userID: userID) { $0.withoutListPlayback }
    }

    /// Clears the recording state from the signed-in user's summary. Call it when a Resume
    /// button finds no recording under way, which a summary written before the app was ended
    /// while suspended can still show.
    func clearRecording() {
        guard let userID = container.currentUserID() else { return }
        rewrite(userID: userID) { $0.withoutRecording }
    }

    /// Rewrites `userID`'s summary with `change` and reloads the widgets that show what changed.
    /// Synchronous, so it finishes before the app can end.
    private func rewrite(userID: String, _ change: (WidgetSummary) -> WidgetSummary) {
        guard let summary = WidgetSummaryFile.read(userID: userID, in: container) else { return }
        let changed = change(summary)
        guard changed != summary else { return }
        do {
            try WidgetSummaryFile.write(changed, userID: userID, in: container)
        } catch {
            Self.logger.warning("The widget summary was not cleared for \(userID, privacy: .private): \(error)")
            return
        }
        reload(WidgetKind.showingChanges(from: summary, to: changed))
    }

    /// Writes the draft's summary when it differs from the last one written, then reloads the
    /// widgets that show what changed.
    private func write(_ draft: inout WidgetSummaryDraft, userID: String) async {
        guard let summary = draft.unwritten else { return }
        guard await Self.write(summary, userID: userID, in: container) else { return }
        let kinds = WidgetKind.showingChanges(from: draft.written, to: summary)
        let listIDs = Set(summary.lists.map(\.id))
        // Reads every stored default, so it runs only when a list comes or goes.
        if listIDs != draft.written.map({ Set($0.lists.map(\.id)) }) { pageStore?.keepPages(forLists: listIDs) }
        draft.written = summary
        reload(kinds)
    }

    /// Off the main actor, since it reads and decodes a file.
    @concurrent
    nonisolated private static func read(userID: String, in container: ShareContainer) async -> WidgetSummary? {
        WidgetSummaryFile.read(userID: userID, in: container)
    }

    /// Off the main actor, as the share extension's files are written.
    @concurrent
    nonisolated private static func write(_ summary: WidgetSummary, userID: String, in container: ShareContainer)
        async -> Bool
    {
        do {
            try WidgetSummaryFile.write(summary, userID: userID, in: container)
            return true
        } catch {
            logger.warning("The widget summary was not written for \(userID, privacy: .private): \(error)")
            return false
        }
    }

    /// Yields `read`'s change each time what it reads changes.
    nonisolated private static func follow(
        _ database: DatabasePool, into changes: AsyncStream<WidgetSummaryChange>.Continuation,
        read: @escaping @Sendable (Database) throws -> WidgetSummaryChange
    ) async {
        await StoreObservation.follow(database, logger: logger, follower: "The widget summary", fetch: read) {
            changes.yield($0)
        }
    }

    /// - Parameter readsRunningElapsed: False leaves a running recording's elapsed time at 0
    ///   unread, so an observation does not track it.
    private static func liveInputs(
        store: CrosstuneStore, recorders: RecorderHost, listPlayback: ListPlayback?, plan: PlanModel?,
        readsRunningElapsed: Bool = true
    ) -> WidgetLiveInputs {
        // Only this store's recorder: right after an account switch, the host can still hold the
        // previous account's.
        let recorder = recorders.heldRecorder(for: store).map { recorder in
            let state = recorder.state
            return RecorderSnapshot(
                state: state, elapsed: state == .recording && !readsRunningElapsed ? 0 : recorder.elapsed,
                resumeAvailable: recorder.resumeAvailable, savedRecordingID: recorder.savedRecordingID,
                errorMessage: recorder.errorMessage)
        }
        return WidgetLiveInputs(
            recorder: recorder ?? .idle, recordingsPlay: loadedRecordingsPlay(plan),
            listPlayback: listPlayback.flatMap(WidgetListPlayback.init))
    }

    /// Whether `plan` plays recordings, or nil before its row's first read, when the unknown plan
    /// would show every account's widgets as Premium for a moment at each launch. Judged from
    /// the row, since the model judges its plan only after the row lands. Reads the model's plan
    /// too, so an observation wakes when the row turns with the clock.
    private static func loadedRecordingsPlay(_ plan: PlanModel?) -> Bool? {
        guard let plan, plan.isLoaded else { return nil }
        _ = plan.plan
        return Plan.from(plan.entitlement, now: .now).recordingsPlay
    }
}

/// One change the publisher merges into the summary.
enum WidgetSummaryChange: Equatable, Sendable {
    case recordings([WidgetRecording])
    case lists(WidgetListsPart)
    case live(WidgetLiveInputs)
    /// The ended recording state set at `token` has stayed on screen long enough.
    case recordingDismissed(token: Int)
    /// Time to check whether a fresh-until date is due to move ahead.
    case keepAlive
    /// The store's recordings and lists have had ``WidgetPublisher/catalogDelay`` to settle.
    case catalogSettled
}

/// What the summary takes from the app's running state rather than from the store.
struct WidgetLiveInputs: Equatable, Sendable {
    var recorder: RecorderSnapshot
    /// Nil until the plan has loaded, which keeps the value last written.
    var recordingsPlay: Bool?
    var listPlayback: WidgetListPlayback?
}

extension WidgetListPlayback {
    /// Nil while no list plays. Playing holds through a tune change, so each change does not
    /// write and reload the widgets twice.
    @MainActor init?(_ playback: ListPlayback) {
        guard let listID = playback.listID, let currentTuneID = playback.currentTuneID else { return nil }
        self.init(
            listID: listID, currentTuneID: currentTuneID, isPlaying: playback.isPlayingOrStarting,
            position: playback.position,
            count: playback.count, nextTuneID: playback.nextTuneID)
    }
}

/// The summary being built: the store's parts, the live state, and what was last written.
struct WidgetSummaryDraft {
    var recordings: [WidgetRecording]?
    var listsPart: WidgetListsPart?
    var written: WidgetSummary?
    private var recordingsPlay: Bool
    private var listPlayback: WidgetListPlayback?
    private var recording = RecordingStateFollower()
    private var recordingFreshness = LiveFreshness()

    /// Starts from the summary an earlier run left, so the widgets keep its recordings and
    /// lists until the store's are read.
    init(leftover: WidgetSummary?) {
        written = leftover
        recordingsPlay = leftover?.recordingsPlay ?? Plan.unknown.recordingsPlay
        recordings = leftover?.recordings
        listsPart = leftover.map { WidgetListsPart(lists: $0.lists, tunerReferenceLabel: $0.tunerReferenceLabel) }
    }

    /// Whether a recording is under way, the only state that goes stale and needs keep-alives.
    /// Its timer counts up on the widget, which would be false once the app ended.
    var isRecording: Bool { recording.shown?.status == .recording }

    /// Changes with each recording state, so a dismissal set for an older one is ignored.
    var recordingToken: Int { recording.token }

    /// The summary to write, or nil before the store's parts are known or when nothing changed.
    var unwritten: WidgetSummary? {
        guard let recordings, let listsPart else { return nil }
        let summary = WidgetSummary(
            recordingsPlay: recordingsPlay, recordings: recordings, lists: listsPart.lists,
            tunerReferenceLabel: listsPart.tunerReferenceLabel, recording: recording.shown,
            recordingFreshUntil: recordingFreshness.freshUntil, listPlayback: listPlayback)
        return summary == written ? nil : summary
    }

    /// Takes `input`. Returns how long an ended recording state stays before
    /// ``dismissRecording(token:)`` clears it, when one just began.
    @discardableResult
    mutating func observe(_ input: WidgetLiveInputs, now: Date) -> Duration? {
        if let play = input.recordingsPlay { recordingsPlay = play }
        listPlayback = input.listPlayback
        let wait = recording.observe(RecordingActivityController.activityState(for: input.recorder, now: now))
        recordingFreshness.follow(isLive: isRecording, now: now)
        return wait
    }

    /// Moves ``WidgetSummary/recordingFreshUntil`` ahead once ``WidgetPublisher/refreshInterval``
    /// has passed, so the written recording stays current while the app runs.
    mutating func keepAlive(now: Date) {
        recordingFreshness.keepAlive(now: now)
    }

    mutating func dismissRecording(token: Int) {
        recording.dismiss(token: token)
    }
}

/// A fresh-until date, set only while what it covers is live.
struct LiveFreshness {
    private(set) var freshUntil: Date?

    mutating func follow(isLive: Bool, now: Date) {
        if !isLive {
            freshUntil = nil
        } else if freshUntil == nil {
            refresh(now: now)
        }
    }

    mutating func keepAlive(now: Date) {
        guard let freshUntil else { return }
        let refreshedAt = freshUntil.addingTimeInterval(-(WidgetPublisher.freshness / .seconds(1)))
        guard now.timeIntervalSince(refreshedAt) >= WidgetPublisher.refreshInterval / .seconds(1) else { return }
        refresh(now: now)
    }

    private mutating func refresh(now: Date) {
        freshUntil = now.addingTimeInterval(WidgetPublisher.freshness / .seconds(1))
    }
}
