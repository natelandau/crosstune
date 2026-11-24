import CrosstunePalette
import CrosstuneRecordingActivity
import CrosstuneWidgetData
import CrosstuneWidgetIntents
import SwiftUI
import WidgetKit

/// The Recordings widget at the small size, also shown in StandBy: the whole widget is record red.
struct SmallRecordingsView: View {
    let mode: RecordingsWidgetMode

    var body: some View {
        Group {
            switch mode {
            case .premium, .ready:
                RecordingsActionButton(action: mode.primaryAction) {
                    VStack(spacing: 10) {
                        RecordRing()
                        Text(RecordingLabels.record)
                            .font(.subheadline.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(.rect)
                }
            case .live(let state):
                SmallLiveRecordingView(state: state, primaryAction: mode.primaryAction)
            }
        }
        // White on record is owner approved for the recording controls, as in the Live Activity.
        .foregroundStyle(Palette.onAccentFill)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The small widget during a recording or just after it: the time and Stop, or the outcome.
private struct SmallLiveRecordingView: View {
    let state: RecordingActivityState
    let primaryAction: RecordingsWidgetAction?

    var body: some View {
        switch state.status {
        case .recording, .interrupted:
            VStack(spacing: 8) {
                if state.status == .interrupted {
                    Text(state.status.label)
                        .font(.footnote.weight(.semibold))
                }
                RecordingElapsedTime(state: state, sizingText: "00:00")
                    .font(.title.weight(.semibold))
                HStack(spacing: 12) {
                    let diameter: CGFloat = state.canResume ? 50 : 58
                    RecordingsActionButton(action: .stop) {
                        RoundGlyph(kind: .stop, diameter: diameter)
                    }
                    if state.canResume {
                        RecordingsActionButton(action: .resume) {
                            RoundGlyph(kind: .resume, diameter: diameter)
                        }
                    }
                }
            }
        case .failed:
            RecordingsActionButton(action: primaryAction) {
                VStack(spacing: 6) {
                    Image(systemName: state.status.systemImage)
                        .font(.title3)
                        .accessibilityHidden(true)
                    Text(state.status.label)
                        .font(.caption.weight(.semibold))
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect)
            }
        case .saving, .saved, .notRecording:
            StatusWords(status: state.status)
                .font(.subheadline.weight(.semibold))
                .imageScale(.large)
        }
    }
}

/// The Recordings widget at the medium and large sizes: the newest recordings above the Record pill.
struct RecordingsListView: View {
    let summary: WidgetSummary
    let mode: RecordingsWidgetMode
    let now: Date
    let rowCount: Int
    let showsHeading: Bool

    var body: some View {
        if mode == .premium {
            // Every tap opens the plan screen, so the whole widget is the one button.
            RecordingsActionButton(action: mode.primaryAction) {
                VStack(spacing: 0) {
                    RecordingsMessage(title: WidgetText.needsPremium, hint: WidgetText.needsPremiumHint)
                    RecordPill(mode: mode)
                        .opacity(0.45)
                }
                .contentShape(.rect)
            }
        } else {
            VStack(spacing: 0) {
                if summary.recordings.isEmpty {
                    RecordingsMessage(title: WidgetText.noRecordings, hint: WidgetText.noRecordingsHint)
                } else {
                    RecentRecordingRows(
                        recordings: summary.recordings.prefix(rowCount), now: now, showsHeading: showsHeading)
                    Spacer(minLength: 0)
                }
                RecordPill(mode: mode)
            }
        }
    }
}

/// The newest recordings, one under another, under an optional heading.
private struct RecentRecordingRows: View {
    let recordings: ArraySlice<WidgetRecording>
    let now: Date
    let showsHeading: Bool

    var body: some View {
        VStack(spacing: 0) {
            if showsHeading {
                Text(WidgetText.recentRecordings)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.textSecondary)
                    .padding(.horizontal, 8)
                    .frame(maxWidth: .infinity, minHeight: 22, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
            }
            ForEach(recordings.enumerated(), id: \.element.id) { index, recording in
                if index > 0 {
                    Rectangle()
                        .fill(Palette.border)
                        .frame(height: 1)
                }
                RecordingRow(recording: recording, now: now)
            }
        }
    }
}

/// One recording: a tap opens it in the app and plays it.
private struct RecordingRow: View {
    let recording: WidgetRecording
    let now: Date

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(intent: PlayRecordingIntent(recording: RecordingEntity(id: recording.id, title: recording.title))) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Text(recording.title)
                        .lineLimit(1)
                    if recording.isUnfiled {
                        Text(RecordingLabels.unfiled)
                            .font(.caption2)
                            .foregroundStyle(Palette.accent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Palette.tint(colorScheme), in: .rect(cornerRadius: 6))
                    }
                }
                Spacer(minLength: 0)
                Text(recording.rowDetail(now: now))
                    .font(.footnote)
                    .foregroundStyle(Palette.textSecondary)
                    .lineLimit(1)
                    .layoutPriority(1)
                Image(systemName: "play.fill")
                    .font(.caption)
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityHidden(true)
            }
            .font(.subheadline)
            .foregroundStyle(Palette.textPrimary)
            .padding(.horizontal, 8)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// The message in place of the rows, centered above the Record pill.
private struct RecordingsMessage: View {
    let title: String
    let hint: String

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.subheadline.bold())
                .foregroundStyle(Palette.textPrimary)
            Text(hint)
                .font(.footnote)
                .foregroundStyle(Palette.textSecondary)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The record red pill along the bottom of the medium and large sizes.
private struct RecordPill: View {
    let mode: RecordingsWidgetMode

    var body: some View {
        switch mode {
        case .premium:
            // The whole widget is the plan button, so the pill is only drawn.
            ReadyPillContents().pill()
        case .ready:
            RecordingsActionButton(action: mode.primaryAction) { ReadyPillContents().pill() }
        case .live(let state):
            switch state.status {
            case .recording:
                RecordingsActionButton(action: mode.primaryAction) {
                    HStack(spacing: 10) {
                        RecordingElapsedTime(state: state, sizingText: "00:00")
                        StopSquare()
                        Text(RecordingActivityText.stop)
                    }
                    .pill()
                }
            case .interrupted:
                HStack(spacing: 4) {
                    Image(systemName: state.status.systemImage)
                        .accessibilityLabel(state.status.label)
                    RecordingElapsedTime(state: state, sizingText: "00:00")
                    Spacer(minLength: 0)
                    if state.canResume {
                        RecordingsActionButton(action: .resume) {
                            PillButtonLabel(title: RecordingActivityText.resume, systemImage: "play.fill")
                        }
                    }
                    RecordingsActionButton(action: .stop) {
                        PillButtonLabel(title: RecordingActivityText.stop, systemImage: "stop.fill")
                    }
                }
                .padding(.leading, 8)
                .pill()
            case .failed:
                RecordingsActionButton(action: mode.primaryAction) {
                    HStack(spacing: 8) {
                        Image(systemName: state.status.systemImage)
                            .accessibilityHidden(true)
                        Text(state.status.label)
                            .font(.caption.weight(.semibold))
                            .lineLimit(2)
                            .minimumScaleFactor(0.8)
                    }
                    .pill()
                }
            case .saving, .saved, .notRecording:
                StatusWords(status: state.status).pill()
            }
        }
    }
}

private struct ReadyPillContents: View {
    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .frame(width: 14, height: 14)
                .widgetAccentable()
                .accessibilityHidden(true)
            Text(RecordingLabels.record)
        }
    }
}

/// Resume or Stop inside the interrupted pill, each its own tap target.
private struct PillButtonLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .padding(.horizontal, 8)
            .frame(minHeight: 44)
            .contentShape(.rect)
    }
}

extension View {
    /// Draws contents as the record red pill: white, semibold, at least 44 points tall.
    fileprivate func pill() -> some View {
        font(.subheadline.weight(.semibold))
            .foregroundStyle(Palette.onAccentFill)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(Palette.record, in: .capsule)
            .contentShape(.capsule)
    }
}

/// The Recordings widget as a lock screen circle, in the system's one tint.
struct AccessoryCircularRecordingsView: View {
    let mode: RecordingsWidgetMode

    /// One tap target fits in the circle, so an interruption offers Stop here and Resume in the
    /// larger widgets.
    var body: some View {
        RecordingsActionButton(action: mode.primaryAction) {
            switch mode {
            case .premium, .ready:
                VStack(spacing: 2) {
                    Image(systemName: "circle.fill")
                        .font(.title3)
                        .widgetAccentable()
                        .accessibilityHidden(true)
                    Text(RecordingLabels.record)
                        .font(.caption)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.circle)
            case .live(let state):
                AccessoryCircularLiveLabel(state: state)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The lock screen circle during a recording or just after it: the time and Stop, or the outcome.
private struct AccessoryCircularLiveLabel: View {
    let state: RecordingActivityState

    var body: some View {
        switch state.status {
        case .recording, .interrupted:
            VStack(spacing: 2) {
                RecordingElapsedTime(state: state, sizingText: "00:00")
                    .font(.headline)
                Image(systemName: "stop.fill")
                    .widgetAccentable()
                    .accessibilityLabel(RecordingActivityText.stop)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(.circle)
        case .failed:
            Image(systemName: state.status.systemImage)
                .font(.title2)
                .accessibilityLabel(state.status.label)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.circle)
        case .saving, .saved, .notRecording:
            VStack(spacing: 2) {
                Image(systemName: state.status.systemImage)
                    .font(.title3)
                    .accessibilityHidden(true)
                Text(state.status.label)
                    .font(.caption2)
                    .minimumScaleFactor(0.7)
            }
        }
    }
}

/// The Recordings widget as a lock screen rectangle, in the system's one tint.
struct AccessoryRectangularRecordingsView: View {
    let mode: RecordingsWidgetMode

    var body: some View {
        Group {
            switch mode {
            case .premium, .ready:
                RecordingsActionButton(action: mode.primaryAction) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(WidgetText.appName)
                            .font(.headline)
                        Label {
                            Text(RecordingLabels.record)
                        } icon: {
                            Image(systemName: "circle.fill").widgetAccentable()
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .contentShape(.rect)
                }
            case .live(let state):
                AccessoryRectangularLiveView(state: state, primaryAction: mode.primaryAction)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// The lock screen rectangle during a recording or just after it: the status, the time, and
/// its controls, or the outcome.
private struct AccessoryRectangularLiveView: View {
    let state: RecordingActivityState
    let primaryAction: RecordingsWidgetAction?

    var body: some View {
        switch state.status {
        case .recording:
            RecordingsActionButton(action: primaryAction) {
                VStack(alignment: .leading, spacing: 2) {
                    StatusAndTime(state: state)
                    Label {
                        Text(RecordingActivityText.stop)
                    } icon: {
                        Image(systemName: "stop.fill").widgetAccentable()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
        case .interrupted:
            VStack(alignment: .leading, spacing: 0) {
                StatusAndTime(state: state)
                HStack(spacing: 12) {
                    if state.canResume {
                        RecordingsActionButton(action: .resume) {
                            AccessoryButtonLabel(title: RecordingActivityText.resume, systemImage: "play.fill")
                        }
                    }
                    RecordingsActionButton(action: .stop) {
                        AccessoryButtonLabel(title: RecordingActivityText.stop, systemImage: "stop.fill")
                    }
                }
            }
        case .failed:
            RecordingsActionButton(action: primaryAction) {
                Label(state.status.label, systemImage: state.status.systemImage)
                    .font(.caption)
                    .lineLimit(4)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
        case .saving, .saved, .notRecording:
            VStack(alignment: .leading, spacing: 2) {
                Text(WidgetText.appName)
                    .font(.headline)
                Label(state.status.label, systemImage: state.status.systemImage)
            }
        }
    }
}

/// "Recording 3:12": the status and the time on one line.
private struct StatusAndTime: View {
    let state: RecordingActivityState

    var body: some View {
        HStack(spacing: 4) {
            Text(state.status.label)
            RecordingElapsedTime(state: state, sizingText: "00:00")
        }
        .font(.headline)
        .lineLimit(1)
    }
}

private struct AccessoryButtonLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label {
            Text(title)
        } icon: {
            Image(systemName: systemImage).widgetAccentable()
        }
        .frame(minHeight: 44)
        .contentShape(.rect)
    }
}

/// The Live Activity's symbol and words for a status that offers no control.
private struct StatusWords: View {
    let status: RecordingActivityState.Status

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: status.systemImage)
                .accessibilityHidden(true)
            Text(status.label)
        }
    }
}

/// Runs the intent for a Recordings widget action, or draws `label` alone when there is none.
private struct RecordingsActionButton<Label: View>: View {
    let action: RecordingsWidgetAction?
    @ViewBuilder let label: Label

    var body: some View {
        Group {
            switch action {
            case .record: Button(intent: StartRecordingIntent()) { label }
            case .openPlan: Button(intent: OpenPlanIntent()) { label }
            case .stop: Button(intent: StopRecordingIntent()) { label }
            case .resume: Button(intent: ResumeRecordingIntent()) { label }
            case .openApp: Button(intent: OpenAppIntent()) { label }
            case nil: label
            }
        }
        .buttonStyle(.plain)
    }
}

/// The small widget's Record glyph: a white ring around a white dot.
private struct RecordRing: View {
    var body: some View {
        Circle()
            .strokeBorder(lineWidth: 4)
            .overlay {
                Circle().padding(10)
            }
            .frame(width: 58, height: 58)
            .widgetAccentable()
            .accessibilityHidden(true)
    }
}

/// The small widget's Stop and Resume buttons: a white circle around a record red symbol.
private struct RoundGlyph: View {
    enum Kind {
        case stop, resume
    }

    let kind: Kind
    let diameter: CGFloat

    var body: some View {
        Circle()
            .fill(Palette.onAccentFill)
            .widgetAccentable()
            .overlay {
                switch kind {
                case .stop:
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Palette.record)
                        .frame(width: diameter * 0.35, height: diameter * 0.35)
                case .resume:
                    Image(systemName: "play.fill")
                        .font(.title2)
                        .foregroundStyle(Palette.record)
                }
            }
            .frame(width: diameter, height: diameter)
            .contentShape(.circle)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(kind == .stop ? RecordingActivityText.stop : RecordingActivityText.resume)
    }
}

/// The pill's Stop mark: a white square.
private struct StopSquare: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 3)
            .frame(width: 12, height: 12)
            .widgetAccentable()
            .accessibilityHidden(true)
    }
}
