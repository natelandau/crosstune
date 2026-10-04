import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "activity")

/// Time on screen a look at a tune's scans needs to count. A glance at how a tune starts is short.
let scanViewThresholdMs: Int64 = 3_000

/// Where the scan viewer was opened, as the API's scan view context names it.
public enum ScanViewOrigin: Hashable, Sendable {
    /// The tune screen's Scans section.
    case tune
    /// A catalog row's Scans action.
    case row
    /// A list row's Scans action.
    case list(id: String)

    var context: Vocabulary.ScanViewContext {
        switch self {
        case .tune: .tune
        case .row: .row
        case .list: .list
        }
    }

    var listID: String? {
        guard case .list(let id) = self else { return nil }
        return id
    }
}

/// Where the scan view log writes each view. `owner` names the store the writes land in, so a
/// writer for another store is told apart from the same store's set again.
public struct ScanViewWriter {
    let owner: AnyHashable
    let write: @MainActor (ScanView) -> Void

    public init(owner: AnyHashable, write: @escaping @MainActor (ScanView) -> Void) {
        self.owner = owner
        self.write = write
    }

    /// Records into `store`. A write that fails is logged and dropped: a lost view is not worth
    /// interrupting the musician over.
    public static func store(_ store: CrosstuneStore) -> ScanViewWriter {
        ScanViewWriter(owner: ObjectIdentifier(store)) { view in
            Task { await record(view, into: store) }
        }
    }

    /// Stores `view`, reporting a failure to `report`. A view ending as the shell tears down
    /// lands after sign-out closed the store, which is no failure: it is dropped quietly.
    static func record(
        _ view: ScanView, into store: CrosstuneStore,
        report: @Sendable (any Error) -> Void = {
            logger.error("A scan view was not recorded: \($0, privacy: .public)")
        }
    ) async {
        guard !store.isClosed else { return }
        do {
            try await Commands(store: store).recordEvent(view)
        } catch {
            if !store.isClosed { report(error) }
        }
    }
}

/// Times one window's open scan viewer while the window is in the foreground, and writes each
/// view that ends having met the threshold. Leaving the foreground ends the view and coming back
/// starts a new one, so a viewer left open overnight is two short views, not one long one. A view
/// belongs to the store open while it was timed: a writer for another store drops it.
@MainActor
public final class ScanViewLog {
    private struct Open {
        let tuneID: String
        let origin: ScanViewOrigin
        /// When the view under way started, or nil while the app is out of the foreground.
        var since: (instant: SuspendingClock.Instant, date: Date)?
    }

    private let clock: @MainActor () -> SuspendingClock.Instant
    private let now: @MainActor () -> Date
    private var open: Open?
    private var isForeground = true

    /// Takes each view that met the threshold. One for another store drops the view open, which
    /// belongs to the store that was open while it was timed.
    public var writer: ScanViewWriter? {
        didSet {
            if writer?.owner != oldValue?.owner { open = nil }
        }
    }

    /// - Parameters:
    ///   - clock: Measures time on screen. It stops while the device sleeps, so a sleep never
    ///     counts as viewing time.
    ///   - now: The wall clock a view's start and creation are stamped with.
    public init(
        clock: @escaping @MainActor () -> SuspendingClock.Instant = { SuspendingClock.now },
        now: @escaping @MainActor () -> Date = Date.init
    ) {
        self.clock = clock
        self.now = now
    }

    /// Ends any open view, then starts a view of `tuneID`'s scans.
    func start(tuneID: String, origin: ScanViewOrigin) {
        end()
        open = Open(tuneID: tuneID, origin: origin, since: isForeground ? (clock(), now()) : nil)
    }

    /// Writes the view under way if it met the threshold, and closes the viewer.
    func end() {
        guard let ended = open else { return }
        open = nil
        finish(ended)
    }

    /// The window entered or left the foreground.
    public func foreground(_ isForeground: Bool) {
        self.isForeground = isForeground
        guard let current = open else { return }
        if isForeground {
            if current.since == nil { open?.since = (clock(), now()) }
            return
        }
        finish(current)
        open?.since = nil
    }

    /// Ends the view of `old` and starts one of `new`, as the presented viewer changes.
    func follow(from old: ScanRequest?, to new: ScanRequest?) {
        guard old != new else { return }
        if let new { start(tuneID: new.tuneID, origin: new.origin) } else { end() }
    }

    /// The presented viewer of `tuneID` has gone, by a close or with the shell around it. Ends
    /// its view, whichever of this and the request change comes first; a view of another tune,
    /// opened since, keeps running.
    func viewerDisappeared(tuneID: String) {
        guard open?.tuneID == tuneID else { return }
        end()
    }

    private func finish(_ ended: Open) {
        guard let since = ended.since else { return }
        let viewedMs = milliseconds(since.instant.duration(to: clock()))
        guard viewedMs >= scanViewThresholdMs else { return }
        let createdAt = Timestamp(now())
        writer?.write(
            ScanView(
                id: newID(at: createdAt), createdAt: createdAt, tuneID: ended.tuneID,
                context: ended.origin.context.rawValue, listID: ended.origin.listID,
                startedAt: Timestamp(since.date), viewedMs: viewedMs))
    }

    private func milliseconds(_ duration: Duration) -> Int64 {
        let (seconds, attoseconds) = duration.components
        return seconds * 1000 + attoseconds / 1_000_000_000_000_000
    }
}
