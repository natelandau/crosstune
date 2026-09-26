import Foundation
import OpenAPIRuntime

extension Configuration {
    /// The configuration every client of the Crosstune API uses.
    public static let crosstune = Configuration(dateTranscoder: APIDateTranscoder())
}

/// Reads the API's timestamps and writes the client's.
///
/// The API writes microseconds, and drops the fraction entirely when it is zero, so both
/// forms must decode. The client writes milliseconds, the precision it stamps edits with.
public struct APIDateTranscoder: DateTranscoder {
    private static let fractional = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let whole = Date.ISO8601FormatStyle()

    public init() {}

    public func encode(_ date: Date) throws -> String {
        // A formatter truncates a Date's floating-point seconds, which often sit a hair under
        // the intended millisecond. Rounding to the API's microsecond first keeps the millisecond
        // the client stamped, and cuts the API's own microseconds to milliseconds as parsing does.
        let microseconds = Int64((date.timeIntervalSince1970 * 1_000_000).rounded())
        let (seconds, remainder) = microseconds.quotientAndRemainder(dividingBy: 1_000_000)
        let (wholeSeconds, fraction) = remainder < 0 ? (seconds - 1, remainder + 1_000_000) : (seconds, remainder)
        let text = Self.whole.format(Date(timeIntervalSince1970: Double(wholeSeconds)))
        return text.dropLast() + String(format: ".%03lldZ", fraction / 1000)
    }

    public func decode(_ dateString: String) throws -> Date {
        if let date = try? Self.fractional.parse(dateString) {
            return date
        }
        return try Self.whole.parse(dateString)
    }
}
