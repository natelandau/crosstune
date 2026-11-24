import CrosstuneWidgetData
import WidgetKit

/// One moment of a widget: what it shows for whoever is signed in.
struct WidgetEntry: TimelineEntry {
    let date: Date
    let current: CurrentWidgetSummary
}

/// Reads the summary the app last wrote. The app reloads a widget's timelines after each write
/// that changes what it shows. A timeline holds one entry, and one more at the recording's
/// fresh-until date, where the recording goes stale.
struct SummaryProvider: TimelineProvider {
    /// True for a widget that shows a recording's day, which stops being Today at midnight with
    /// no write from the app.
    let reloadsAtMidnight: Bool

    func placeholder(in context: Context) -> WidgetEntry {
        currentEntries()[0]
    }

    func getSnapshot(in context: Context, completion: @escaping (WidgetEntry) -> Void) {
        completion(currentEntries()[0])
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WidgetEntry>) -> Void) {
        let calendar = Calendar.current
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: .now))
        let policy: TimelineReloadPolicy = reloadsAtMidnight ? tomorrow.map { .after($0) } ?? .never : .never
        completion(Timeline(entries: currentEntries(), policy: policy))
    }

    private func currentEntries() -> [WidgetEntry] {
        WidgetTimeline.moments(for: WidgetSummaryFile.readCurrent(), now: .now).map {
            WidgetEntry(date: $0.date, current: $0.current)
        }
    }
}
