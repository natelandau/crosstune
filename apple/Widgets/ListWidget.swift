import CrosstunePalette
import CrosstuneWidgetData
import CrosstuneWidgetIntents
import SwiftUI
import WidgetKit

/// Play, shuffle, and follow one list the musician picks, without finding it in the app.
struct ListWidget: Widget {
    /// The widget's name in the widget gallery.
    static let displayName = "List"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: WidgetKind.list.rawValue, intent: ListWidgetConfigurationIntent.self, provider: ListProvider()
        ) { entry in
            SummaryContent(current: entry.current) { summary in
                ListWidgetView(state: ListWidgetState(summary: summary, listID: entry.listID), page: entry.page)
            }
        }
        .configurationDisplayName(Self.displayName)
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryRectangular,
        ])
        // The heading row and the rows fill the medium and large sizes only inside margins
        // narrower than the system's.
        .contentMarginsDisabled()
        // A removable background gives way to the system's gray on a dark home screen, which
        // hides the dark Shuffle fill. StandBy also keeps the page background.
        .containerBackgroundRemovable(false)
    }
}

/// One moment of a List widget: the summary, the list it was set up with, and the page to show.
struct ListWidgetEntry: TimelineEntry {
    let date: Date
    let current: CurrentWidgetSummary
    /// Nil until the musician picks a list.
    let listID: String?
    let page: Int
}

/// Reads the summary the app last wrote. The app reloads the List timelines after each write
/// that changes a list or its playback, and a page button reloads them too. A timeline holds the
/// moments ``WidgetTimeline/moments(for:now:)`` plans, and never asks for a refresh.
struct ListProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ListWidgetEntry {
        entry(listID: nil, in: context)
    }

    func snapshot(for configuration: ListWidgetConfigurationIntent, in context: Context) async -> ListWidgetEntry {
        entry(listID: configuration.list?.id, in: context)
    }

    func timeline(for configuration: ListWidgetConfigurationIntent, in context: Context) async -> Timeline<
        ListWidgetEntry
    > {
        Timeline(entries: entries(listID: configuration.list?.id, in: context), policy: .never)
    }

    private func entry(listID: String?, in context: Context) -> ListWidgetEntry {
        entries(listID: listID, in: context)[0]
    }

    private func entries(listID: String?, in context: Context) -> [ListWidgetEntry] {
        let moments = WidgetTimeline.moments(for: WidgetSummaryFile.readCurrent(), now: .now)
        // The widget gallery shows the widget before a list is picked, so it previews the first.
        // A preview shows the first page and leaves the stored page, which a placed widget owns.
        guard !context.isPreview else {
            return moments.map { moment in
                var shownList = listID
                if case .available(let summary) = moment.current { shownList = listID ?? summary.lists.first?.id }
                return ListWidgetEntry(date: moment.date, current: moment.current, listID: shownList, page: 0)
            }
        }
        let page =
            ListWidgetPageStore.appGroup()?.page(for: moments, listID: listID, size: ListWidgetSize(context.family))
            ?? 0
        return moments.map { moment in
            ListWidgetEntry(date: moment.date, current: moment.current, listID: listID, page: page)
        }
    }
}

extension ListWidgetSize {
    /// The lock screen shows no rows, as the small size does.
    init(_ family: WidgetFamily) {
        switch family {
        case .systemMedium: self = .medium
        case .systemLarge: self = .large
        case .systemExtraLarge: self = .extraLarge
        default: self = .small
        }
    }
}

private struct ListWidgetView: View {
    let state: ListWidgetState
    let page: Int

    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetContentMargins) private var contentMargins

    var body: some View {
        if family == .accessoryRectangular {
            // Straight on the wallpaper inside the system's margins, as the system's rectangles are.
            AccessoryRectangularListView(state: state)
                .padding(contentMargins)
                .containerBackground(for: .widget) { Color.clear }
        } else {
            content
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .containerBackground(for: .widget) { Palette.pageBackground }
        }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .chooseList:
            ChooseListView()
        case .empty(let list):
            EmptyListView(list: list)
        case .ready, .active:
            if family == .systemSmall {
                SmallListView(state: state)
            } else {
                ListRowsView(state: state, size: ListWidgetSize(family), page: page)
            }
        }
    }
}

extension WidgetListTune {
    fileprivate static let previewTunes = [
        WidgetListTune(id: "t1", title: "Soldier's Joy", detail: "D · Reel"),
        WidgetListTune(id: "t2", title: "Cluck Old Hen", detail: "A · Breakdown · AEAE"),
        WidgetListTune(id: "t3", title: "Big Sciota", detail: "G · Reel"),
        WidgetListTune(id: "t4", title: "Ashokan Farewell", detail: "D · Waltz"),
        WidgetListTune(id: "t5", title: "Red Haired Boy", detail: "A · Reel"),
        WidgetListTune(id: "t6", title: "Sally Goodin", detail: "A · AEAE"),
        WidgetListTune(id: "t7", title: "Forked Deer", detail: "D · Reel"),
        WidgetListTune(id: "t8", title: "Kitchen Girl", detail: "A · Reel"),
        WidgetListTune(id: "t9", title: "Whiskey Before Breakfast", detail: "D · Reel"),
        WidgetListTune(id: "t10", title: "Liberty", detail: "D · Reel"),
        WidgetListTune(id: "t11", title: "Angeline the Baker", detail: "D · Reel"),
        WidgetListTune(id: "t12", title: "Arkansas Traveler", detail: "D · Reel"),
    ]
}

extension ListWidgetEntry {
    fileprivate static func preview(
        listID: String? = "practice", tunes: [WidgetListTune] = WidgetListTune.previewTunes, isPlaying: Bool? = nil,
        page: Int = 0
    ) -> ListWidgetEntry {
        let playback = isPlaying.map {
            WidgetListPlayback(
                listID: "practice", currentTuneID: "t2", isPlaying: $0, position: 2, count: 12, nextTuneID: "t3")
        }
        let summary = WidgetSummary(
            recordingsPlay: true, recordings: [], lists: [WidgetList(id: "practice", name: "Practice", tunes: tunes)],
            tunerReferenceLabel: nil, recording: nil, recordingFreshUntil: nil, listPlayback: playback)
        return ListWidgetEntry(date: .now, current: .available(summary), listID: listID, page: page)
    }

    /// Every state the List widget draws, for each size's preview.
    fileprivate static let previewStates: [ListWidgetEntry] = [
        .preview(), .preview(isPlaying: true), .preview(isPlaying: false), .preview(tunes: []),
        .preview(listID: nil), .preview(page: 1), .preview(page: 2),
        ListWidgetEntry(date: .now, current: .unavailable, listID: "practice", page: 0),
    ]
}

#Preview("Small", as: .systemSmall) {
    ListWidget()
} timeline: {
    for entry in ListWidgetEntry.previewStates { entry }
}

#Preview("Medium", as: .systemMedium) {
    ListWidget()
} timeline: {
    for entry in ListWidgetEntry.previewStates { entry }
}

#Preview("Large", as: .systemLarge) {
    ListWidget()
} timeline: {
    for entry in ListWidgetEntry.previewStates { entry }
}

#Preview("Extra large", as: .systemExtraLarge) {
    ListWidget()
} timeline: {
    for entry in ListWidgetEntry.previewStates { entry }
}

#Preview("Lock screen rectangle", as: .accessoryRectangular) {
    ListWidget()
} timeline: {
    for entry in ListWidgetEntry.previewStates { entry }
}
