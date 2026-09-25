import Foundation
import GRDB

/// A point in time at millisecond precision, the precision the client stamps edits with.
///
/// Held as whole milliseconds rather than a `Date`, whose floating-point seconds can land a
/// hair under a millisecond and compare or round wrong. Stored and sent as ISO 8601 text with
/// three fraction digits in UTC, which sorts as text in time order.
public struct Timestamp: Hashable, Comparable, Sendable {
    public let milliseconds: Int64

    public init(milliseconds: Int64) {
        self.milliseconds = milliseconds
    }

    public init(_ date: Date) {
        milliseconds = Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
    }

    public static var now: Timestamp { Timestamp(Date()) }

    public var date: Date { Date(timeIntervalSince1970: Double(milliseconds) / 1000) }

    public static func < (lhs: Timestamp, rhs: Timestamp) -> Bool {
        lhs.milliseconds < rhs.milliseconds
    }

    /// This time, or one millisecond past `stored` when this is not later.
    ///
    /// The push guard and the server's strictly-newer rule tell two writes to one row apart
    /// only by `updated_at`, so a tie would drop the second write.
    public func stamped(after stored: Timestamp?) -> Timestamp {
        guard let stored, stored.milliseconds >= milliseconds else { return self }
        return Timestamp(milliseconds: stored.milliseconds + 1)
    }
}

extension Timestamp {
    private static let whole = Date.ISO8601FormatStyle()

    /// Parses an ISO 8601 time, keeping the first three fraction digits as JavaScript does.
    public init?(iso string: String) {
        // The API writes microseconds and drops a zero fraction; either may carry an offset.
        let pattern = #/(.+T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})/#
        guard let match = string.wholeMatch(of: pattern),
            let seconds = try? Self.whole.parse(String(match.1 + match.3))
        else { return nil }
        let fraction = String((match.2 ?? "").prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0)
        milliseconds = Int64(seconds.timeIntervalSince1970) * 1000 + Int64(fraction)!
    }

    public var iso: String {
        let (seconds, remainder) = milliseconds.quotientAndRemainder(dividingBy: 1000)
        let (wholeSeconds, fraction) = remainder < 0 ? (seconds - 1, remainder + 1000) : (seconds, remainder)
        let text = Self.whole.format(Date(timeIntervalSince1970: Double(wholeSeconds)))
        return text.dropLast() + String(format: ".%03lldZ", fraction)
    }
}

extension Timestamp: Codable {
    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let text = try container.decode(String.self)
        guard let value = Timestamp(iso: text) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an ISO 8601 time: \(text)")
        }
        self = value
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(iso)
    }
}

extension Timestamp: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { iso.databaseValue }

    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> Timestamp? {
        String.fromDatabaseValue(dbValue).flatMap { Timestamp(iso: $0) }
    }
}
