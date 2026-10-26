import CrosstuneStore
import Foundation
import Observation

/// The signed-in account's plan, kept current as the entitlements row changes and as the clock
/// passes the row's next turning point. One per store, so another account's plan never carries
/// over.
@MainActor
@Observable
public final class PlanModel {
    public private(set) var plan: Plan = .unknown
    /// When the plan was last judged: on each row change and at each instant the row turns, so
    /// something else judged by the clock can follow the same turning points without a timer.
    public private(set) var judgedAt: Date?
    /// The stored row, nil until the first pull that carries it.
    public var entitlement: Entitlement? { row.value ?? nil }
    /// Whether the first read of the row has landed, so unknown is not claimed before it has.
    public var isLoaded: Bool { row.value != nil }
    /// The recordings and scans the server refused as Premium only, which wait on this device.
    public var isLocalUntilSubscribed: Set<String> { holds.value }

    private let row: LiveQuery<Entitlement??>
    private let holds: LiveQuery<Set<String>>
    private let now: @MainActor () -> Date
    private let sleep: @MainActor (TimeInterval) async throws -> Void
    @ObservationIgnored private var following: Task<Void, Never>?
    @ObservationIgnored private var timer: Task<Void, Never>?
    private let notifications: NotificationCenter
    @ObservationIgnored private var clockObserver: (any NSObjectProtocol)?

    /// - Parameter notifications: Where the system says its clock was set.
    public init(
        store: CrosstuneStore,
        now: @escaping @MainActor () -> Date = Date.init,
        sleep: @escaping @MainActor (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) },
        notifications: NotificationCenter = .default
    ) {
        self.now = now
        self.sleep = sleep
        self.notifications = notifications
        let row = LiveQuery<Entitlement??>(store, initial: nil) { db in .some(try Entitlement.current(db)) }
        self.row = row
        holds = LiveQuery<Set<String>>(store, initial: []) { db in try StoreWriter.localOnlyRows(in: db) }
        following = Task { [weak self] in
            for await _ in Observations({ @MainActor in row.value }) {
                self?.judge()
            }
        }
        // The timer sleeps for an interval, so a clock set by hand or by the network would leave
        // it waking at the wrong instant.
        clockObserver = notifications.addObserver(forName: .NSSystemClockDidChange, object: nil, queue: nil) {
            [weak self] _ in
            Task { @MainActor in self?.judge() }
        }
    }

    isolated deinit {
        following?.cancel()
        timer?.cancel()
        if let clockObserver { notifications.removeObserver(clockObserver) }
    }

    /// Judges the plan again from the clock, for when time may have passed unseen, such as while
    /// the app was in the background.
    public func judgeAgain() {
        judge()
    }

    /// Judges the plan now and sets one timer for the next instant the answer changes, replacing
    /// any timer set for an older row.
    private func judge() {
        timer?.cancel()
        timer = nil
        let instant = now()
        plan = Plan.from(entitlement, now: instant)
        judgedAt = instant
        guard let next = PlanRules.nextChange(entitlement, now: instant) else { return }
        timer = Task { [weak self, sleep] in
            do {
                try await sleep(next.timeIntervalSince(instant))
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            self?.judge()
        }
    }
}

@MainActor
extension PlanModel? {
    /// Whether recordings play. Until a plan model is around the plan is unknown, which plays them.
    var recordingsPlay: Bool { self?.plan.recordingsPlay ?? Plan.unknown.recordingsPlay }
}
