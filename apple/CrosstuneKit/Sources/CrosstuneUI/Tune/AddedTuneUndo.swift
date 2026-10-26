import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import GRDB
import Observation
import SwiftUI
import os

extension CrosstuneCommands.Commands {
    /// Creates a tune from its title alone, reports it as made from `source`, and reports a
    /// recording it was filed under; see ``Commands/createTitleOnly(title:listID:recordingID:at:)``.
    func createTitleOnly(
        title: String, source: ActionSource, listID: String? = nil, recordingID: String? = nil,
        analytics: AnalyticsClient = .noop
    ) async throws -> CreatedTune {
        let created = try await createTitleOnly(title: title, listID: listID, recordingID: recordingID)
        analytics.send(.tuneCreated(source: source, fieldsSet: created.fieldsSet, tuneID: created.tuneID))
        if let recording = created.filedRecording, recording.tuneID != created.tuneID {
            analytics.recordingFiled(recording, under: created.tuneID)
        }
        return created
    }
}

extension CreatedTune {
    /// The fields the tune was made with: its title, and the status and genre the settings gave
    /// it where they differ from a blank tune's.
    var fieldsSet: [TuneField] {
        var fields: Set<TuneField> = [.title]
        if defaults.status != TuneFormValues().status { fields.insert(.status) }
        if defaults.genre != nil { fields.insert(.genre) }
        return TuneField.allCases.filter(fields.contains)
    }
}

/// The window's "Added" banner for a tune made from its title, whose Undo deletes the tune. The
/// shell owns it, so the banner outlasts the screen that made the tune and follows the musician
/// onto the tune's page.
///
/// Undo never deletes work: it is taken from the banner the moment anything is added to the
/// tune, wherever that happens, and the delete itself checks again in the same transaction, so
/// an Undo pressed before the banner hears of the addition keeps the tune. Undo never navigates;
/// the tune's own page leaves once its tune is gone. System undo carries the same Undo and is
/// withdrawn with it.
@MainActor
@Observable
public final class AddedTuneUndo {
    nonisolated public static func added(_ title: String) -> String {
        "Added \(title)"
    }

    /// The notice after an Undo that kept the tune, since something was added to it meanwhile.
    nonisolated public static func kept(_ title: String) -> String {
        "Kept \(title), since something was added to it"
    }

    /// The Edit menu's name for the Undo.
    nonisolated public static let undoActionName = "Add tune"

    /// What the banner shows, nil when nothing.
    public var undoBannerItem: UndoBannerItem?
    /// The last tune an Undo deleted, which its page leaves.
    public private(set) var undone: String?
    /// The window's undo manager, which carries the banner's Undo for Command-Z, the Edit menu,
    /// and shake.
    @ObservationIgnored public weak var undoManager: UndoManager?
    /// Whether VoiceOver runs, which gives a banner longer before it leaves.
    @ObservationIgnored public var voiceOverRunning = false

    private let store: CrosstuneStore
    private let analytics: AnalyticsClient
    private let waitOut: @MainActor (_ voiceOver: Bool) async throws -> Void
    private let create: @MainActor (_ title: String, _ source: ActionSource) async throws -> CreatedTune
    /// True from an add until it lands or fails, so a second press creates nothing more.
    @ObservationIgnored private var isAdding = false
    /// Whether an add is running now.
    var isAddRunning: Bool { isAdding }
    /// Adds waiting for the running one to land.
    @ObservationIgnored private var addWaiters: [CheckedContinuation<Void, Never>] = []
    /// How many adds wait for the running one now.
    var waitingAddCount: Int { addWaiters.count }
    /// Counts the banners shown, so an Undo that lands after a newer one leaves it alone.
    @ObservationIgnored private(set) var shownCount = 0
    /// One deadline per banner, whichever tab or column draws it.
    @ObservationIgnored private var deadline: Task<Void, Never>?
    /// Follows the added tune for work or its delete, to take Undo away once either arrives.
    @ObservationIgnored private var watch: Task<Void, Never>?
    @ObservationIgnored private var watchedTuneID: String?
    /// The target the shown Undo is registered against in the undo manager, so it can be
    /// withdrawn on its own. The manager does not retain it.
    @ObservationIgnored private var systemUndo: SystemUndoTarget?
    /// Notices that wait for the banner whose Undo is on show, so none takes that Undo, shown
    /// first in, first out.
    @ObservationIgnored private var pendingNotices: [String] = []
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "added-tune")

    /// - Parameter waitOut: Returns once a banner's time is up, given whether VoiceOver runs.
    public convenience init(
        store: CrosstuneStore, analytics: AnalyticsClient = .noop,
        waitOut: @escaping @MainActor (_ voiceOver: Bool) async throws -> Void = {
            try await Task.sleep(for: UndoBanner.timeout(voiceOver: $0))
        }
    ) {
        self.init(store: store, analytics: analytics, waitOut: waitOut) { title, source in
            try await CrosstuneCommands.Commands(store: store).createTitleOnly(
                title: title, source: source, analytics: analytics)
        }
    }

    /// - Parameter create: Makes the tune from its title, reported as made from `source`.
    init(
        store: CrosstuneStore, analytics: AnalyticsClient = .noop,
        waitOut: @escaping @MainActor (_ voiceOver: Bool) async throws -> Void = {
            try await Task.sleep(for: UndoBanner.timeout(voiceOver: $0))
        },
        create: @escaping @MainActor (_ title: String, _ source: ActionSource) async throws -> CreatedTune
    ) {
        self.store = store
        self.analytics = analytics
        self.waitOut = waitOut
        self.create = create
    }

    isolated deinit {
        watch?.cancel()
        deadline?.cancel()
    }

    /// Creates a tune from its title and shows its Undo in the banner. The new tune's id, or nil
    /// when another add is running or the create failed, whose reason the banner shows.
    public func add(title: String, source: ActionSource) async -> String? {
        guard !isAdding else { return nil }
        isAdding = true
        defer {
            isAdding = false
            let waiting = addWaiters
            addWaiters = []
            for waiter in waiting { waiter.resume() }
        }
        do {
            let created = try await create(title, source)
            showUndo(tuneID: created.tuneID, title: created.title)
            return created.tuneID
        } catch {
            Self.logger.warning("A tune could not be added from its title: \(error)")
            show(UndoBannerItem(message: failureMessage(error)))
            return nil
        }
    }

    /// ``add(title:source:)`` once any add already running has landed, rather than refused, for
    /// a title already taken from its field, such as a new-tune draft's or the catalog search's,
    /// which would otherwise be lost.
    func addAfterAnyRunning(title: String, source: ActionSource) async -> String? {
        while isAdding {
            await withCheckedContinuation { addWaiters.append($0) }
        }
        return await add(title: title, source: source)
    }

    /// Shows a notice with no Undo in the banner, such as a refusal from a screen that is closing.
    /// A banner offering Undo keeps it: the notice follows once that banner leaves or loses its
    /// Undo, after any notice already waiting.
    public func notify(_ message: String) {
        if undoBannerItem?.undo != nil || !pendingNotices.isEmpty {
            pendingNotices.append(message)
        } else {
            show(UndoBannerItem(message: message))
        }
    }

    private func showUndo(tuneID: String, title: String) {
        let shown = UndoBannerItem(message: Self.added(title)) { [weak self] in
            guard let self else { return }
            stopWatching()
            withdrawSystemUndo()
            let pressedAt = shownCount
            Task { await self.undo(tuneID: tuneID, title: title, pressedAt: pressedAt) }
        }
        show(shown)
        let target = SystemUndoTarget()
        systemUndo = target
        undoManager?.registerUndo(withTarget: target) { [weak self] _ in
            MainActor.assumeIsolated {
                // An Undo withdrawn while its event's group was still open stays in the stack.
                guard let self, self.systemUndo === target else { return }
                if self.undoBannerItem?.id == shown.id { self.undoBannerItem = nil }
                self.systemUndo = nil
                self.stopWatching()
                let pressedAt = self.shownCount
                Task { await self.undo(tuneID: tuneID, title: title, pressedAt: pressedAt) }
            }
        }
        undoManager?.setActionName(Self.undoActionName)
        let store = store
        watchedTuneID = tuneID
        watch = Task { [weak self] in
            let blocked = ValueObservation.tracking { db in
                try tuneHasWork(db, tuneID: tuneID) || !isLiveTune(db, tuneID: tuneID)
            }
            .removeDuplicates()
            .values(in: store.database)
            do {
                for try await isBlocked in blocked where isBlocked {
                    self?.withdrawUndo(from: shown.id)
                    return
                }
            } catch {
                // A store that stops answering leaves Undo to the delete's own check.
            }
        }
    }

    private func show(_ next: UndoBannerItem) {
        stopWatching()
        withdrawSystemUndo()
        shownCount += 1
        undoBannerItem = next
        let id = next.id
        let voiceOver = voiceOverRunning
        let waitOut = waitOut
        deadline?.cancel()
        deadline = Task { [weak self] in
            do {
                try await waitOut(voiceOver)
            } catch {
                return
            }
            if !Task.isCancelled { self?.expire(id) }
        }
    }

    /// The banner's time is up: it leaves, its Undo with it, menu and all.
    private func expire(_ id: UUID) {
        guard undoBannerItem?.id == id else { return }
        stopWatching()
        withdrawSystemUndo()
        undoBannerItem = nil
        showPendingNotice()
    }

    private func showPendingNotice() {
        guard !pendingNotices.isEmpty else { return }
        show(UndoBannerItem(message: pendingNotices.removeFirst()))
    }

    private func withdrawSystemUndo() {
        if let systemUndo { undoManager?.removeAllActions(withTarget: systemUndo) }
        systemUndo = nil
    }

    private func stopWatching() {
        watch?.cancel()
        watch = nil
        watchedTuneID = nil
    }

    private func withdrawUndo(from id: UUID) {
        withdrawSystemUndo()
        guard let item = undoBannerItem, item.id == id else { return }
        undoBannerItem = item.withoutUndo()
        showPendingNotice()
    }

    /// - Parameter pressedAt: ``shownCount`` when Undo was pressed. A banner shown since is
    ///   newer, and this Undo's notice never replaces it.
    func undo(tuneID: String, title: String, pressedAt: Int) async {
        var isLatest: Bool { shownCount == pressedAt }
        do {
            switch try await CrosstuneCommands.Commands(store: store).deleteTuneUnlessItHasWork(tuneID) {
            case .deleted:
                undone = tuneID
                // Deleted only with nothing attached, so it took no recording, link, or scan.
                analytics.send(.tuneDeleted(tuneID: tuneID, recordings: 0, links: 0, scans: 0))
                if isLatest { showPendingNotice() }
            case .gone:
                // Deleted already, here or elsewhere, which reported it then.
                if isLatest { showPendingNotice() }
            case .kept:
                if isLatest { show(UndoBannerItem(message: Self.kept(title))) }
            }
        } catch {
            Self.logger.warning("An added tune could not be undone: \(error)")
            if isLatest { show(UndoBannerItem(message: failureMessage(error))) }
        }
    }
}

/// What an Added Undo is registered against in the undo manager.
private final class SystemUndoTarget {}

extension View {
    /// Shows the window's Added banner over this view while it is on screen. Each tab or column
    /// that can show a new tune carries one, and only the one on screen draws it, so the banner
    /// is announced once.
    func addedTuneBanner() -> some View {
        modifier(AddedTuneBanner())
    }
}

private struct AddedTuneBanner: ViewModifier {
    @Environment(AddedTuneUndo.self) private var added: AddedTuneUndo?
    @State private var isShown = false

    func body(content: Content) -> some View {
        content
            // The banner keeps its own deadline, so a tab coming back never restarts it.
            .undoBanner(
                Binding {
                    isShown ? added?.undoBannerItem : nil
                } set: {
                    added?.undoBannerItem = $0
                },
                timesOut: false
            )
            .onAppear { isShown = true }
            .onDisappear { isShown = false }
    }
}
