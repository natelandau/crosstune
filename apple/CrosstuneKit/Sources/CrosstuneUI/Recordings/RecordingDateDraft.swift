import CrosstuneCommands
import CrosstuneStore
import Foundation

/// A recorded date as the Edit sheet holds it: a typed year, narrowed by an optional month and
/// day. A take's exact time survives only while its date parts are left as they opened.
public struct RecordingDateDraft: Equatable, Sendable {
    /// Why the parts cannot be stored.
    public enum Problem: Error, Equatable, Sendable {
        case yearFormat
        case future

        public var message: String {
            switch self {
            case .yearFormat: "Enter the year as four digits."
            case .future: CommandError.recordedDateFutureMessage
            }
        }
    }

    private struct Parts: Equatable, Sendable {
        var year = ""
        var month: Int?
        var day: Int?
    }

    private var parts: Parts
    private let opened: Parts
    /// The take's instant when the date opened at time precision.
    private let take: Timestamp?
    private let timeZone: TimeZone

    public var year: String { parts.year }
    /// Nil is Any.
    public var month: Int? { parts.month }
    /// Nil is Any.
    public var day: Int? { parts.day }

    /// `timeZone` reads a take's day; a partial date is read in UTC, where it is stored.
    public init(recordedAt: Timestamp?, precision: RecordingPrecision?, timeZone: TimeZone = .current) {
        self.timeZone = timeZone
        var start = Parts()
        if let recordedAt, let precision {
            let calendar = Self.calendar(precision == .time ? timeZone : .gmt)
            let read = calendar.dateComponents([.year, .month, .day], from: recordedAt.date)
            start.year = read.year.map(String.init) ?? ""
            start.month = precision == .year ? nil : read.month
            start.day = precision == .day || precision == .time ? read.day : nil
        }
        parts = start
        opened = start
        take = precision == .time ? recordedAt : nil
    }

    /// The recording's date, or no date when its precision is one this build predates.
    public init(recording: Recording, timeZone: TimeZone = .current) {
        let known = recording.knownRecordedDate
        self.init(recordedAt: known?.at, precision: known?.precision, timeZone: timeZone)
    }

    /// Whether the parts differ from those the draft opened with. Only a changed date is written.
    public var isChanged: Bool { parts != opened }

    /// Whether saving keeps the take's exact time.
    public var keepsTime: Bool { take != nil && !isChanged }

    /// The take's instant while it is kept, for the note under the date.
    public var keptTake: Timestamp? { keepsTime ? take : nil }

    public var isEmpty: Bool { parts == Parts() }

    public var isMonthEnabled: Bool { Self.isFullYear(parts.year) }

    public var isDayEnabled: Bool { isMonthEnabled && parts.month != nil }

    /// How many days the chosen month offers: none without a month, and 31 while the year is not
    /// yet one, so a day already chosen keeps its option.
    public var dayCount: Int {
        guard let month = parts.month else { return 0 }
        guard Self.isFullYear(parts.year), let year = Int(parts.year) else { return 31 }
        let calendar = Self.calendar(.gmt)
        guard let first = calendar.date(from: DateComponents(year: year, month: month, day: 1)) else { return 31 }
        return calendar.range(of: .day, in: .month, for: first)?.count ?? 31
    }

    /// Keeps the digits typed, up to four.
    public mutating func setYear(_ text: String) {
        parts.year = String(text.filter(\.isASCII).filter(\.isNumber).prefix(4))
        normalize()
    }

    public mutating func setMonth(_ month: Int?) {
        parts.month = month
        normalize()
    }

    public mutating func setDay(_ day: Int?) {
        parts.day = day
        normalize()
    }

    public mutating func clear() {
        parts = Parts()
    }

    /// A day only narrows a month, and one the month or year lacks reads as Any rather than
    /// rolling over.
    private mutating func normalize() {
        if parts.month == nil {
            parts.day = nil
        } else if let day = parts.day, day > dayCount {
            parts.day = nil
        }
    }

    /// The date to store at the most specific part given: the take itself while it is kept, no
    /// date without a year whatever month or day is left behind it, else UTC midnight at the
    /// start of the period.
    public func resolved(now: Timestamp = .now) throws(Problem) -> (at: Timestamp?, precision: RecordingPrecision?) {
        if keepsTime, let take { return (take, .time) }
        if parts.year.isEmpty { return (nil, nil) }
        guard Self.isFullYear(parts.year), let year = Int(parts.year) else { throw .yearFormat }
        if year > Self.calendar(timeZone).component(.year, from: now.date) { throw .future }
        let components = DateComponents(year: year, month: parts.month ?? 1, day: parts.day ?? 1)
        guard let start = Self.calendar(.gmt).date(from: components) else { throw .yearFormat }
        let at = Timestamp(start)
        if at.milliseconds > now.milliseconds + recordedAtLeewayMs { throw .future }
        let precision: RecordingPrecision = parts.day != nil ? .day : parts.month != nil ? .month : .year
        return (at, precision)
    }

    private static func isFullYear(_ year: String) -> Bool {
        year.count == 4 && year.first != "0" && year.allSatisfy(\.isNumber)
    }

    private static func calendar(_ timeZone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }
}
