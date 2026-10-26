import CrosstuneAnalytics
import CrosstuneStore
import Foundation
import GRDB
import Observation
import SwiftUI

/// What the notices are judged from, read in one transaction so a seen notice dropped from this
/// device's list is never read beside a row that does not carry it yet.
struct NoticeInputs: Sendable, Equatable {
    var row: Entitlement?
    /// The notices dismissed on this device that the row does not carry yet.
    var seen: Set<PlanNotice>
    var holdsRecordings: Bool

    static func fetch(_ db: Database) throws -> NoticeInputs {
        NoticeInputs(
            row: try Entitlement.current(db),
            seen: try StoreWriter.seenNotices(in: db),
            holdsRecordings: try Recording.filter(Recording.CodingKeys.deletedAt == nil).fetchCount(db) > 0)
    }
}

/// Which window shows the plan notices, shared by every window over one store, so a due notice
/// shows in one window at a time and is reported once per app session.
@MainActor
@Observable
public final class NoticeClaim {
    /// The notice model whose window shows notices now, nil while none does.
    fileprivate var holder: ObjectIdentifier?
    /// The notices reported as shown this session.
    @ObservationIgnored fileprivate var reported: Set<PlanNotice> = []
    /// Dismissed this session, so a notice never shows again in any window before its seen mark
    /// is read back from the store.
    @ObservationIgnored fileprivate var dismissed: Set<PlanNotice> = []

    public init() {}

    fileprivate func take(_ owner: ObjectIdentifier) -> Bool {
        if holder == nil { holder = owner }
        return holder == owner
    }

    fileprivate func release(_ owner: ObjectIdentifier) {
        if holder == owner { holder = nil }
    }
}

extension EnvironmentValues {
    /// Shared by every window over the open store. The app sets it at the root of each scene;
    /// without one, a shell keeps its own.
    @Entry public var noticeClaim: NoticeClaim?
}

/// Decides when a one-time plan notice shows in one window: the one due now that the account
/// has not seen, one at a time, only while nothing covers this window's shell and no take is
/// capturing, and only while no other window sharing its ``NoticeClaim`` shows one. Made for
/// one `PlanModel`, so it follows the open store's plan.
@MainActor
@Observable
final class NoticeModel {
    /// The notice up now, nil while none is.
    private(set) var showing: PlanNotice?
    /// Whether the first read of the store has been judged.
    private(set) var isLoaded = false

    /// The latest inputs read from the store, nil before the first read.
    var inputs: NoticeInputs? { query.value ?? nil }
    /// When the trial ends, for the notices that name the day.
    var trialEndsAt: Date? {
        guard let row = inputs?.row else { return nil }
        return (row.trialEndsAt ?? row.premiumExpiresAt)?.date
    }

    private let store: CrosstuneStore
    private let analytics: AnalyticsClient
    private let claim: NoticeClaim
    private let now: @MainActor () -> Date
    private let query: LiveQuery<NoticeInputs??>
    @ObservationIgnored private var covered = false
    @ObservationIgnored private var capturing = false
    /// False once the window has gone, so a model not yet released never takes the claim again.
    @ObservationIgnored private var isActive = true
    @ObservationIgnored private var following: Task<Void, Never>?

    private var id: ObjectIdentifier { ObjectIdentifier(self) }

    init(
        store: CrosstuneStore, plan: PlanModel, analytics: AnalyticsClient, claim: NoticeClaim = NoticeClaim(),
        now: @escaping @MainActor () -> Date = Date.init
    ) {
        self.store = store
        self.analytics = analytics
        self.claim = claim
        self.now = now
        let query = LiveQuery<NoticeInputs??>(store, initial: nil) { db in .some(try NoticeInputs.fetch(db)) }
        self.query = query
        // The plan's judging instants are the ones a notice turns due at, so following them
        // replaces a timer of the notice's own. A claim let go may be this window's turn.
        following = Task { [weak self] in
            for await _ in Observations({ @MainActor in (plan.judgedAt, query.value ?? nil, claim.holder) }) {
                self?.evaluate()
            }
        }
    }

    isolated deinit {
        following?.cancel()
        claim.release(ObjectIdentifier(self))
    }

    /// Reports what covers the shell. A notice waits while a sheet, dialog, or selection covers
    /// it, or a take is capturing, and shows once none does.
    func coverChanged(covered: Bool, capturing: Bool) {
        self.covered = covered
        self.capturing = capturing
        evaluate()
    }

    /// Takes the notice down and marks it seen, which the next sync tells the server. The next
    /// due notice, if any, shows once nothing covers the shell.
    func dismiss() {
        guard let notice = showing else { return }
        claim.dismissed.insert(notice)
        showing = nil
        let store = store
        Task {
            do {
                try await store.write { writer in try writer.markNoticeSeen(notice) }
            } catch {
                // The notice stays dismissed for this session; it may show again next launch.
            }
        }
        evaluate()
    }

    /// The window has gone: takes down any notice without marking it seen, and lets another
    /// window show it.
    func leave() {
        isActive = false
        showing = nil
        claim.release(id)
    }

    /// The window is back after ``leave()``.
    func rejoin() {
        guard !isActive else { return }
        isActive = true
        evaluate()
    }

    private func evaluate() {
        guard let inputs else { return }
        isLoaded = true
        guard isActive else { return }
        let seen = inputs.row?.seeing(inputs.seen.union(claim.dismissed), at: Timestamp(now()))
        // Dismissed in another window, or on another device, while it was up here.
        if let notice = showing, seen?.hasSeen(notice) == true { showing = nil }
        // A window keeps the claim while its own notice sheet leaves, so the next notice shows
        // here once it has gone rather than over it in another window.
        guard showing == nil, !covered, !capturing else { return }
        guard let seen, let notice = PlanRules.dueNotice(seen, now: now(), holdsRecordings: inputs.holdsRecordings)
        else {
            claim.release(id)
            return
        }
        guard claim.take(id) else { return }
        showing = notice
        if claim.reported.insert(notice).inserted, let kind = NoticeKind(rawValue: notice.rawValue) {
            analytics.send(.noticeShown(notice: kind))
        }
    }
}
