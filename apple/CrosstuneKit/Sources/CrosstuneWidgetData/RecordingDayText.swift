import CrosstuneRecordingActivity
import CrosstuneVocabulary
import Foundation

/// How a recording's date reads, in the app's recording rows and the Recordings widget alike.
public enum RecordingDayText {
    public static let today = "Today"

    /// When the music was played, worded only as far as its precision knows. A time reads as a
    /// medium date and short time in `timeZone`.
    public static func recordedDate(
        _ date: Date, precision: RecordingPrecision, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> String {
        // A partial date is stored as UTC midnight at the start of its period, so it is read in
        // UTC: read locally west of UTC, 1937 would read as 1936.
        let partial = Date.FormatStyle(locale: locale, timeZone: .gmt)
        return switch precision {
        case .year: date.formatted(partial.year())
        case .month: date.formatted(partial.month(.abbreviated).year())
        case .day: addedDay(date, locale: locale, timeZone: .gmt)
        case .time:
            date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened, locale: locale, timeZone: timeZone))
        }
    }

    /// The day of an exact instant in `timeZone`, as a medium date.
    public static func addedDay(_ date: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        date.formatted(Date.FormatStyle(date: .abbreviated, locale: locale, timeZone: timeZone))
    }

    /// A short day that reads at a glance: Today, or a weekday within the past week, when the day
    /// is known. Otherwise the date as the app writes it.
    public static func day(
        of date: Date, precision: RecordingPrecision, now: Date, calendar: Calendar = .current,
        locale: Locale = .current
    ) -> String {
        let timeZone = calendar.timeZone
        let shownDay: Date
        switch precision {
        case .year, .month:
            return recordedDate(date, precision: precision, locale: locale, timeZone: timeZone)
        case .time:
            shownDay = calendar.startOfDay(for: date)
        case .day:
            // The stored UTC midnight names a calendar day, which is compared with today's local day.
            var utc = calendar
            utc.timeZone = .gmt
            guard let local = calendar.date(from: utc.dateComponents([.year, .month, .day], from: date)) else {
                return recordedDate(date, precision: precision, locale: locale, timeZone: timeZone)
            }
            shownDay = local
        }
        switch calendar.dateComponents([.day], from: shownDay, to: calendar.startOfDay(for: now)).day {
        case 0: return today
        case .some(1...6):
            return shownDay.formatted(
                Date.FormatStyle(locale: locale, calendar: calendar, timeZone: timeZone).weekday(.abbreviated))
        default: return addedDay(shownDay, locale: locale, timeZone: timeZone)
        }
    }
}

extension WidgetRecording {
    /// "Today · 2:41": the day and the length, which is left out while unknown, as the app's
    /// recording rows leave it out.
    public func rowDetail(now: Date, calendar: Calendar = .current, locale: Locale = .current) -> String {
        [
            RecordingDayText.day(
                of: recordedAt, precision: recordedPrecision, now: now, calendar: calendar, locale: locale),
            duration.map(RecordingActivityText.duration(ofSeconds:)),
        ].compactMap(\.self).joined(separator: " · ")
    }
}
