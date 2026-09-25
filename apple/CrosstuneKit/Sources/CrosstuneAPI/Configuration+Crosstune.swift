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
        Self.fractional.format(date)
    }

    public func decode(_ dateString: String) throws -> Date {
        if let date = try? Self.fractional.parse(dateString) {
            return date
        }
        return try Self.whole.parse(dateString)
    }
}
