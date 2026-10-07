import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// A calendar day with no zone. Arithmetic runs on days since 1970-01-01, so a day is always one
/// day long whatever the musician's zone does around a clock change.
struct PlainDate {
    let year: Int
    let month: Int
    let day: Int

    /// Reads `YYYY-MM-DD`, or the date part of a longer string.
    init?(_ text: String) {
        let parts = text.prefix(10).split(separator: "-")
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
        else { return nil }
        self.init(year: year, month: month, day: day)
    }

    init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    // Howard Hinnant's days_from_civil and civil_from_days, for the proleptic Gregorian calendar.
    var daysSinceEpoch: Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yearOfEra = y - era * 400
        let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    init(daysSinceEpoch days: Int) {
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let dayOfEra = z - era * 146_097
        let yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146_096) / 365
        let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        let shiftedMonth = (5 * dayOfYear + 2) / 153
        let month = shiftedMonth + (shiftedMonth < 10 ? 3 : -9)
        self.init(
            year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month: month,
            day: dayOfYear - (153 * shiftedMonth + 2) / 5 + 1)
    }

    /// 0 for Sunday through 6 for Saturday.
    var weekday: Int { floorMod(daysSinceEpoch + 4, 7) }  // 1970-01-01 was a Thursday.

    var text: String { String(format: "%04d-%02d-%02d", year, month, day) }
}

func floorMod(_ value: Int, _ divisor: Int) -> Int {
    ((value % divisor) + divisor) % divisor
}

func isLeapYear(_ year: Int) -> Bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// The local date of an ISO 8601 instant in `zone`.
func localPlainDate(_ text: String, in zone: TimeZone) -> PlainDate? {
    Timestamp(iso: text).flatMap { localPlainDate($0, in: zone) }
}

/// The local date of `timestamp` in `zone`.
func localPlainDate(_ timestamp: Timestamp, in zone: TimeZone) -> PlainDate? {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let parts = calendar.dateComponents([.year, .month, .day], from: timestamp.date)
    guard let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
    return PlainDate(year: year, month: month, day: day)
}

/// The local date of an ISO 8601 instant in `zone`, `YYYY-MM-DD`.
public func localDate(_ instant: String, in zone: TimeZone) -> String? {
    localPlainDate(instant, in: zone)?.text
}

/// The `YYYY-MM` that is `count` months after `month`; negative counts go back.
func addMonths(_ month: String, _ count: Int) -> String {
    let parts = month.split(separator: "-")
    let index = (Int(parts[0]) ?? 0) * 12 + (Int(parts[1]) ?? 1) - 1 + count
    let year = Int((Double(index) / 12).rounded(.down))
    return String(format: "%04d-%02d", year, floorMod(index, 12) + 1)
}

/// Every `YYYY-MM` from `first` through `last`, inclusive.
func monthsBetween(_ first: String, _ last: String) -> [String] {
    var months: [String] = []
    var month = first
    while !precedes(last, month) {
        months.append(month)
        month = addMonths(month, 1)
    }
    return months
}
