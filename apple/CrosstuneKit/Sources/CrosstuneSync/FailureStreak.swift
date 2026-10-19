import Foundation

/// How long a loop's failures in a row must go on before they are reported to diagnostics.
let lastingFailure: Duration = .seconds(300)

/// Whether a failure is worth reporting to diagnostics. An expired session waits on the musician
/// signing in again, a weak connection on the network, and a stopped engine on nothing, not on a fix.
public func isReportableFailure(_ error: any Error) -> Bool {
    switch underlying(error) {
    case is RunStopped, is DeviceOffline: false
    case let error as URLError where connectivityFailures.contains(error.code): false
    default: !isAuthFailure(error)
    }
}

/// The `URLError` codes a poor or missing connection raises while the device still reads as online.
private let connectivityFailures: Set<URLError.Code> = [
    .timedOut, .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost,
    .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff,
]

/// A run of failures in a row, which says once when it has gone on long enough to report.
///
/// No timer of its own: the loop's backoff caps at a minute, so the failure that crosses the
/// mark comes within a minute of it. A failure more than `gap` after the one before starts a new
/// streak, so two failures either side of a suspended app or a sleeping Mac never add up to one.
struct FailureStreak {
    private let lasting: TimeInterval
    private let gap: TimeInterval
    private var startedAt: Date?
    private var lastFailedAt: Date?
    private var reported = false

    init(lasting: Duration, gap: Duration = retryBackoff[retryBackoff.count - 1] * 2) {
        self.lasting = lasting / .seconds(1)
        self.gap = gap / .seconds(1)
    }

    /// Notes a failure at `date`. True exactly once per streak: on the first failure at least
    /// `lasting` after the streak's first.
    mutating func failed(at date: Date) -> Bool {
        defer { lastFailedAt = date }
        if let lastFailedAt, date.timeIntervalSince(lastFailedAt) > gap { ended() }
        guard let startedAt else {
            startedAt = date
            return false
        }
        guard !reported, date.timeIntervalSince(startedAt) >= lasting else { return false }
        reported = true
        return true
    }

    /// Ends the streak, so the next failure starts a new one.
    mutating func ended() {
        startedAt = nil
        lastFailedAt = nil
        reported = false
    }
}
