import CrosstuneCommands
import CrosstuneVocabulary
import Foundation

/// Every word the stats screen and the Settings summary row show, as the web writes them.
public enum StatsCopy {
    nonisolated public static let title = "Stats"

    nonisolated public static let countsHeader = "Catalog"
    nonisolated public static let recordedHeader = "Recorded"
    nonisolated public static let monthsHeader = "Over time"
    nonisolated public static let activityHeader = "Activity"
    nonisolated public static let onThisDayHeader = "On this day"
    nonisolated public static let raritiesHeader = "Rarities"

    nonisolated public static let tunesLabel = "Tunes"
    nonisolated public static let listsLabel = "Lists"
    nonisolated public static let recordingsLabel = "Recordings"
    nonisolated public static let linksLabel = "Links"
    nonisolated public static let knownLabel = Vocabulary.statusLabels["known"]!
    nonisolated public static let learningLabel = Vocabulary.statusLabels["learning"]!
    nonisolated public static let unknownLabel = Vocabulary.statusLabels["want_to_learn"]!

    nonisolated public static let tunesAddedLabel = "Tunes added"
    /// The toggle that widens the month bars from the last 12 months to every month.
    nonisolated public static let allTime = "All time"
    nonisolated public static let activityHint = "Tap a day to see what happened."
    /// Names the key grid for assistive technology.
    nonisolated public static let keyGridCaption = "Tunes by key and mode"

    /// Column headings for the key grid, short enough to sit side by side at phone width.
    nonisolated public static let modeColumns = [
        "major": "Maj", "minor": "Min", "dorian": "Dor", "mixolydian": "Mix", "modal": "Modal", "other": "Other",
    ]

    nonisolated static func count(_ n: Int, _ one: String, _ many: String) -> String {
        "\(groupedThousands(n)) \(n == 1 ? one : many)"
    }

    nonisolated private static func countTunes(_ n: Int) -> String { count(n, "tune", "tunes") }
    nonisolated private static func countRecordings(_ n: Int) -> String { count(n, "recording", "recordings") }
    nonisolated private static func countScans(_ n: Int) -> String { count(n, "scan", "scans") }

    /// The Settings row that opens the stats screen. Scans appear only when there are any.
    nonisolated public static func summaryLine(tunes: Int, lists: Int, recordings: Int, scans: Int, ms: Int) -> String {
        [
            countTunes(tunes), count(lists, "list", "lists"), countRecordings(recordings),
            scans > 0 ? countScans(scans) : nil, formatRecorded(ms),
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }

    /// The button that opens a breakdown past its first rows: `Show all 12`.
    nonisolated public static func showAll(_ count: Int) -> String {
        "Show all \(groupedThousands(count))"
    }

    /// The recorded total: `37 recordings · 9 h 12 m`.
    nonisolated public static func recordedLine(recordings: Int, ms: Int) -> String {
        "\(countRecordings(recordings)) · \(formatRecorded(ms))"
    }

    /// The quiet line under the counts, shown only when some tunes are archived.
    nonisolated public static func archivedLine(_ n: Int) -> String {
        "\(count(n, "archived tune", "archived tunes")), not counted above"
    }

    /// The counts block's scans line, shown only when there are any: `86 scans across 41 tunes`.
    nonisolated public static func scansLine(scans: Int, tunes: Int) -> String {
        "\(countScans(scans)) across \(countTunes(tunes))"
    }

    /// A key's total in the key grid, as assistive technology reads its control.
    nonisolated public static func keyCellLabel(_ key: String, _ n: Int) -> String {
        "\(key), \(countTunes(n))"
    }

    /// One key and mode cell of the key grid.
    nonisolated public static func keyModeCellLabel(_ key: String, _ mode: String, _ n: Int) -> String {
        "\(key) \(mode), \(countTunes(n))"
    }

    nonisolated private static func formatter(_ template: String) -> DateFormatter {
        let formatter = DateFormatter()
        // The web writes dates in en-US whatever the device's language, and so do these.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = template
        return formatter
    }

    // Made once: the heatmap formats a day per active cell on every redraw.
    nonisolated private static let plainDate = formatter("yyyy-MM-dd")
    nonisolated private static let shortMonth = formatter("MMM")
    nonisolated private static let monthYear = formatter("MMM yyyy")
    nonisolated private static let dayThisYear = formatter("MMM d")
    nonisolated private static let dayOtherYear = formatter("MMM d, yyyy")

    nonisolated private static func utcDate(_ text: String) -> Date? {
        plainDate.date(from: String(text.prefix(10)))
    }

    /// The month label over each heatmap column: the short month at the week holding its 1st, or
    /// nil. Two 1sts are at least four weeks apart, so no two labels crowd each other.
    nonisolated public static func weekMonthLabels(_ days: [Stats.Day]) -> [String?] {
        stride(from: 0, to: days.count, by: 7).map { start in
            let week = days[start..<min(start + 7, days.count)]
            guard let first = week.first(where: { $0.date.hasSuffix("-01") }), let date = utcDate(first.date)
            else { return nil }
            return shortMonth.string(from: date)
        }
    }

    /// `YYYY-MM` as `Oct 2026`.
    nonisolated public static func monthLabel(_ month: String) -> String {
        utcDate("\(month)-01").map(monthYear.string) ?? month
    }

    /// One month's bar, as assistive technology reads it.
    nonisolated public static func monthBarLabel(_ month: String, _ n: Int) -> String {
        "\(monthLabel(month)): \(groupedThousands(n))"
    }

    /// A heatmap day's detail, with only the nonzero parts and the year only when it is not
    /// `today`'s: "Mar 14 · 12 plays · 2 practice sessions · 3 scans viewed · 3 tunes added".
    nonisolated public static func dayDetail(_ day: Stats.Day, today: String) -> String {
        let format = day.date.prefix(4) == today.prefix(4) ? dayThisYear : dayOtherYear
        let date = utcDate(day.date).map(format.string) ?? day.date
        let parts: [String?] = [
            day.plays > 0 ? count(day.plays, "play", "plays") : nil,
            day.practiceSessions > 0 ? count(day.practiceSessions, "practice session", "practice sessions") : nil,
            day.scanViews > 0 ? count(day.scanViews, "scan viewed", "scans viewed") : nil,
            day.recordings > 0 ? countRecordings(day.recordings) : nil,
            day.tunesAdded > 0 ? count(day.tunesAdded, "tune added", "tunes added") : nil,
            day.statusChanges > 0 ? count(day.statusChanges, "status change", "status changes") : nil,
        ]
        return ([date] + parts.compactMap { $0 }).joined(separator: " · ")
    }

    nonisolated private static func yearsAgo(_ years: Int) -> String {
        years == 1 ? "one year ago" : "\(years) years ago"
    }

    nonisolated private static func capitalized(_ text: String) -> String {
        text.prefix(1).uppercased() + text.dropFirst()
    }

    /// One on-this-day line. `title` names the tune, or for a recording line its tune or its own
    /// label. Nil, when nothing names it, reads as "a tune" or "a recording".
    nonisolated public static func onThisDayLine(_ line: Stats.OnThisDay, title: String?) -> String {
        let ago = yearsAgo(line.years)
        let name = title ?? "a tune"
        return switch line.kind {
        case .firstTune: "Your first tune, \(name), \(ago)"
        case .firstRecording: "Your first recording, \(ago)"
        case .tuneAdded: "\(capitalized(ago)) you added \(name)"
        // A recording counts on the day it was added, which may be long after it was played.
        case .recording:
            title.map { "\(capitalized(ago)) you added a recording of \($0)" }
                ?? "\(capitalized(ago)) you added a recording"
        case .learned: "You learned \(name) \(ago)"
        }
    }

    nonisolated private static func instrumentWord(_ instrument: String?) -> String {
        guard let instrument else { return "" }
        return Vocabulary.instrumentLabels[instrument]?.lowercased() ?? instrument
    }

    /// One rarity line. The tune it names shows beside it.
    nonisolated public static func rarityLine(_ rarity: Stats.Rarity) -> String {
        switch rarity.attribute {
        case .keyMode: "Your only tune in \(rarity.value)"
        case .timeSignature: "Your only \(rarity.value) tune"
        case .tuning: "Your only \(instrumentWord(rarity.instrument)) tune in \(rarity.value)"
        case .tuneType: "Your only \(rarity.value)"
        case .genre: "Your only \(rarity.value) tune"
        }
    }
}
