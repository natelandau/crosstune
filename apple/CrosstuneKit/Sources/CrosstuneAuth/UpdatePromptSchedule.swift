import Foundation

/// When the app asks the musician to update a build the API refuses: on the first refusal, when
/// asked directly, and on a return to the foreground once ``interval`` has passed since it last
/// asked.
struct UpdatePromptSchedule: Sendable {
    static let interval: Duration = .seconds(4 * 60 * 60)

    /// True once the API has refused this build.
    private(set) var isRequired = false
    /// Whether the prompt is up. Settable, so an alert can dismiss it.
    var isShowing = false

    private let interval: Duration
    private var shownAt: Date?

    init(interval: Duration = Self.interval) {
        self.interval = interval
    }

    /// Records the API's refusal. Only the first refusal asks.
    ///
    /// - Returns: True when this refusal is the first, so the build has just become unsupported.
    mutating func refused(at now: Date) -> Bool {
        guard !isRequired else { return false }
        isRequired = true
        show(at: now)
        return true
    }

    /// Asks again on a return to the foreground, once the interval has passed since the last ask.
    mutating func foregrounded(at now: Date) {
        guard isRequired else { return }
        if let shownAt, now.timeIntervalSince(shownAt) < interval / .seconds(1) { return }
        show(at: now)
    }

    mutating func show(at now: Date) {
        isShowing = true
        shownAt = now
    }
}
