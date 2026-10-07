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

    // The API writes microseconds and drops a zero fraction; either may carry an offset.
    // A Regex is not Sendable, but this one is never mutated after initialization.
    private nonisolated(unsafe) static let pattern = #/(.+T\d{2}:\d{2}:\d{2})(?:\.([0-9]+))?(Z|[+-]\d{2}:\d{2})/#

    /// Parses an ISO 8601 time, keeping the first three fraction digits as JavaScript does.
    public init?(iso string: String) {
        guard let milliseconds = Self.canonicalMilliseconds(string) ?? Self.parsedMilliseconds(string)
        else { return nil }
        self.milliseconds = milliseconds
    }

    static func parsedMilliseconds(_ string: String) -> Int64? {
        guard let match = string.wholeMatch(of: pattern),
            let seconds = try? whole.parse(String(match.1 + match.3)),
            let fraction = Int64(String((match.2 ?? "").prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0))
        else { return nil }
        return Int64(seconds.timeIntervalSince1970) * 1000 + fraction
    }

    /// Reads the client's own `YYYY-MM-DDTHH:MM:SS.mmmZ` form with integer arithmetic, or nil
    /// for anything else, which the general parser then handles.
    ///
    /// Every stored time and most sent ones take this form, and the general parser costs far
    /// more per call. Years before 1900 fall through, so the general parser's calendar
    /// decides them.
    static func canonicalMilliseconds(_ string: String) -> Int64? {
        let utf8 = string.utf8
        return utf8.withContiguousStorageIfAvailable { canonicalMilliseconds(bytes: $0) }
            ?? Array(utf8).withUnsafeBufferPointer { canonicalMilliseconds(bytes: $0) }
    }

    private static func canonicalMilliseconds(bytes: UnsafeBufferPointer<UInt8>) -> Int64? {
        guard bytes.count == 24, bytes[4] == UInt8(ascii: "-"), bytes[7] == UInt8(ascii: "-"),
            bytes[10] == UInt8(ascii: "T"), bytes[13] == UInt8(ascii: ":"), bytes[16] == UInt8(ascii: ":"),
            bytes[19] == UInt8(ascii: "."), bytes[23] == UInt8(ascii: "Z")
        else { return nil }
        func number(_ start: Int, _ length: Int) -> Int64? {
            var value: Int64 = 0
            for index in start..<(start + length) {
                let digit = bytes[index] &- UInt8(ascii: "0")
                guard digit < 10 else { return nil }
                value = value * 10 + Int64(digit)
            }
            return value
        }
        guard let year = number(0, 4), let month = number(5, 2), let day = number(8, 2),
            let hour = number(11, 2), let minute = number(14, 2), let second = number(17, 2),
            let fraction = number(20, 3),
            year >= 1900, (1...12).contains(month), hour < 24, minute < 60, second < 60
        else { return nil }
        let isLeap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        let monthLengths: [Int64] = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        guard day >= 1, day <= monthLengths[Int(month - 1)] else { return nil }
        // Howard Hinnant's days_from_civil, with March as the first month of the year.
        let shiftedYear = month <= 2 ? year - 1 : year
        let era = shiftedYear / 400
        let yearOfEra = shiftedYear - era * 400
        let dayOfYear = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        let days = era * 146_097 + dayOfEra - 719_468
        return ((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + fraction
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
