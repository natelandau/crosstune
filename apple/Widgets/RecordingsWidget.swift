import CrosstunePalette
import CrosstuneRecordingActivity
import CrosstuneWidgetData
import SwiftUI
import WidgetKit

/// Record, follow, and stop a recording, and play the newest recordings, without finding them
/// in the app.
struct RecordingsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.recordings.rawValue, provider: SummaryProvider(reloadsAtMidnight: true)) {
            entry in
            SummaryContent(current: entry.current) { summary in
                RecordingsWidgetView(summary: summary, now: entry.date)
            }
        }
        .configurationDisplayName(RecordingLabels.title)
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular])
        // Two rows and the Record pill fill a medium widget only inside margins narrower than
        // the system's.
        .contentMarginsDisabled()
        // StandBy keeps the record red rather than drawing the contents on black.
        .containerBackgroundRemovable(false)
    }
}

private struct RecordingsWidgetView: View {
    let summary: WidgetSummary
    let now: Date

    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetContentMargins) private var contentMargins

    var body: some View {
        let mode = RecordingsWidgetMode(summary)
        switch family {
        case .accessoryCircular:
            AccessoryCircularRecordingsView(mode: mode)
                .containerBackground(for: .widget) { AccessoryWidgetBackground() }
        case .accessoryRectangular:
            // Straight on the wallpaper inside the system's margins, as the system's rectangles are.
            AccessoryRectangularRecordingsView(mode: mode)
                .padding(contentMargins)
                .containerBackground(for: .widget) { Color.clear }
        case .systemSmall:
            SmallRecordingsView(mode: mode)
                .padding(12)
                .containerBackground(for: .widget) { Palette.record }
        default:
            RecordingsListView(
                summary: summary, mode: mode, now: now, rowCount: family == .systemLarge ? 5 : 2,
                showsHeading: family == .systemLarge
            )
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .containerBackground(for: .widget) { Palette.pageBackground }
        }
    }
}

extension RecordingActivityState {
    fileprivate static let previewRecording = RecordingActivityState(
        status: .recording, timerStart: .now.addingTimeInterval(-192), elapsed: 192, canResume: false)
    fileprivate static let previewInterrupted = RecordingActivityState(
        status: .interrupted, timerStart: nil, elapsed: 192, canResume: true)
    fileprivate static let previewSaving = RecordingActivityState(
        status: .saving, timerStart: nil, elapsed: 192, canResume: false)
    fileprivate static let previewSaved = RecordingActivityState(
        status: .saved, timerStart: nil, elapsed: 192, canResume: false)
    fileprivate static let previewFailed = RecordingActivityState(
        status: .failed, timerStart: nil, elapsed: 192, canResume: false)
}

extension WidgetEntry {
    fileprivate static func preview(
        recordingsPlay: Bool = true, recordings: [WidgetRecording] = WidgetRecording.previewRecordings,
        recording: RecordingActivityState? = nil
    ) -> WidgetEntry {
        WidgetEntry(
            date: .now,
            current: .available(.preview(recordingsPlay: recordingsPlay, recordings: recordings, recording: recording)))
    }

    /// Every state the Recordings widget draws, for each size's preview.
    fileprivate static let previewStates: [WidgetEntry] = [
        .preview(), .preview(recording: .previewRecording), .preview(recording: .previewInterrupted),
        .preview(recording: .previewSaving), .preview(recording: .previewSaved), .preview(recording: .previewFailed),
        .preview(recordings: []), .preview(recordingsPlay: false),
        .preview(recordings: [WidgetRecording.previewRecordingWithNoLength]),
        WidgetEntry(date: .now, current: .unavailable),
        WidgetEntry(date: .now, current: .signedOut),
    ]
}

#Preview("Small", as: .systemSmall) {
    RecordingsWidget()
} timeline: {
    for entry in WidgetEntry.previewStates { entry }
}

#Preview("Medium", as: .systemMedium) {
    RecordingsWidget()
} timeline: {
    for entry in WidgetEntry.previewStates { entry }
}

#Preview("Large", as: .systemLarge) {
    RecordingsWidget()
} timeline: {
    for entry in WidgetEntry.previewStates { entry }
}

#Preview("Lock screen circle", as: .accessoryCircular) {
    RecordingsWidget()
} timeline: {
    for entry in WidgetEntry.previewStates { entry }
}

#Preview("Lock screen rectangle", as: .accessoryRectangular) {
    RecordingsWidget()
} timeline: {
    for entry in WidgetEntry.previewStates { entry }
}
