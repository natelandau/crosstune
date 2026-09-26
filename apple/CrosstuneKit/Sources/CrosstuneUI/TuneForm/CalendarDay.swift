import Foundation

/// A calendar date stored as `YYYY-MM-DD`, with no time or zone, and the `Date` a date picker
/// shows it as.
public enum CalendarDay {
    /// The stored text is always a Gregorian date, whatever calendar the musician reads in; the
    /// zone is the device's, so the picker shows the day that was stored.
    public static var gregorian: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }

    /// Noon on the stored day, so no time zone shift moves it to a neighboring day. Nil for text
    /// that is not a `YYYY-MM-DD` date.
    public static func date(_ day: String, calendar: Calendar = gregorian) -> Date? {
        let parts = day.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
            let year = Int(parts[0]), let month = Int(parts[1]), let dayOfMonth = Int(parts[2])
        else { return nil }
        let components = DateComponents(year: year, month: month, day: dayOfMonth, hour: 12)
        guard components.isValidDate(in: calendar) else { return nil }
        return calendar.date(from: components)
    }

    /// The day `date` falls on in `calendar`, as `YYYY-MM-DD`.
    public static func day(_ date: Date, calendar: Calendar = gregorian) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}
