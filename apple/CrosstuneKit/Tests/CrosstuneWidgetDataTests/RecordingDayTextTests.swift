import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneWidgetData

struct RecordingDayTextTests {
    /// West of UTC, so a day-precision date read as a local instant would fall a day early.
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return calendar
    }()
    /// Monday, November 23, 2026, 07:00 in Los Angeles.
    private static let now = Date(timeIntervalSince1970: 1_795_446_000)

    private static func at(_ text: String) -> Date {
        try! Date(text, strategy: .iso8601)
    }

    @Test(arguments: [
        ("2026-11-23T14:00:00Z", RecordingPrecision.time, RecordingDayText.today),
        ("2026-11-22T20:00:00Z", .time, "Sun"),
        ("2026-11-17T20:00:00Z", .time, "Tue"),
        ("2026-11-16T20:00:00Z", .time, "Nov 16, 2026"),
        ("2026-11-24T20:00:00Z", .time, "Nov 24, 2026"),
        ("2026-11-23T00:00:00Z", .day, RecordingDayText.today),
        ("2026-11-22T00:00:00Z", .day, "Sun"),
        ("1998-10-03T00:00:00Z", .day, "Oct 3, 1998"),
        ("1998-05-01T00:00:00Z", .month, "May 1998"),
        ("1937-01-01T00:00:00Z", .year, "1937"),
    ])
    func aDayReadsAsTodayAWeekdayOrAsTheAppWritesIt(date: String, precision: RecordingPrecision, expected: String) {
        let text = RecordingDayText.day(
            of: Self.at(date), precision: precision, now: Self.now, calendar: Self.calendar,
            locale: Locale(identifier: "en_US"))
        #expect(text == expected)
    }
}

/// A recording row's second line leaves out a length that is not known yet, as the app's rows do.
struct WidgetRecordingDetailTests {
    @Test(arguments: [(TimeInterval?.some(61), "\(RecordingDayText.today) · 1:01"), (nil, RecordingDayText.today)])
    func theDetailShowsTheDayAndAnyKnownLength(duration: TimeInterval?, expected: String) {
        let now = Date(timeIntervalSince1970: 1_795_446_000)
        let recording = WidgetRecording(
            id: "r1", title: "Kesh", isUnfiled: false, recordedAt: now, recordedPrecision: .time, duration: duration)
        #expect(recording.rowDetail(now: now) == expected)
    }
}
