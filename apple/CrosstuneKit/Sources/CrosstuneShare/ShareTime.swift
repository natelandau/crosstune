import Foundation

/// Times as the shared folder stores them: whole milliseconds since 1970.
enum ShareTime {
    static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded())
    }
}
