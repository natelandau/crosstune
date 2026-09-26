import CrosstuneStore
import Foundation

/// When something was last edited, in local calendar days: "Edited today", "Edited Mar 4".
public enum EditedText {
    public static let today = "Edited today"
    public static let yesterday = "Edited yesterday"

    /// "Edited today", "Edited yesterday", or the short date, with the year only when it is not
    /// the current one.
    public static func label(
        _ edited: Timestamp, now: Date = .now, calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        let days =
            calendar.dateComponents(
                [.day], from: calendar.startOfDay(for: edited.date), to: calendar.startOfDay(for: now)
            ).day ?? 0
        if days <= 0 { return today }
        if days == 1 { return yesterday }
        var style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
            .month(.abbreviated).day()
        if calendar.component(.year, from: edited.date) != calendar.component(.year, from: now) {
            style = style.year()
        }
        return "Edited \(edited.date.formatted(style))"
    }
}
