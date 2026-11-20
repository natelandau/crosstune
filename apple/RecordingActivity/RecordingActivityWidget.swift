import ActivityKit
import CrosstunePalette
import CrosstuneRecordingActivity
import SwiftUI
import WidgetKit

/// The Live Activity for a recording under way: the lock screen and the Dynamic Island.
struct RecordingActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            RecordingActivityContent(state: context.shownState, meterHeight: 32)
                .padding()
        } dynamicIsland: { context in
            let state = context.shownState
            return DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    RecordingActivityContent(state: state, meterHeight: 20)
                }
            } compactLeading: {
                RecordingStatusSymbol(status: state.status)
            } compactTrailing: {
                if state.status != .saving && state.status != .failed {
                    // Past 100 minutes this can clip: more room costs island width on every recording.
                    RecordingElapsedTime(state: state, sizingText: "00:00")
                }
            } minimal: {
                RecordingStatusSymbol(status: state.status)
            }
        }
    }
}

/// The status, the time, the meter, and the buttons, which the lock screen and the expanded
/// Dynamic Island share.
private struct RecordingActivityContent: View {
    let state: RecordingActivityState
    let meterHeight: CGFloat

    var body: some View {
        if state.status == .failed {
            Label {
                Text(RecordingActivityText.saveFailed)
            } icon: {
                RecordingStatusSymbol(status: .failed)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(state.status.label)
                        .font(.headline)
                    Spacer()
                    RecordingElapsedTime(state: state, sizingText: "000:00")
                        .font(.title2.weight(.semibold))
                }
                .accessibilityElement(children: .combine)
                RecordingMeterView(bars: state.bars)
                    .frame(height: meterHeight)
                RecordingActivityButtons(state: state)
            }
        }
    }
}

/// Stop, and Resume after an interruption that allows it.
private struct RecordingActivityButtons: View {
    static let minHeight: CGFloat = 44

    let state: RecordingActivityState

    var body: some View {
        if state.status == .recording || state.status == .interrupted {
            HStack {
                Button(intent: StopRecordingIntent()) {
                    Text(RecordingActivityText.stop)
                        .font(.headline)
                        .foregroundStyle(Palette.onRecord)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .frame(maxWidth: .infinity, minHeight: Self.minHeight)
                        .background(Palette.record, in: .capsule)
                }
                .buttonStyle(.plain)
                if state.canResume {
                    Button(intent: ResumeRecordingIntent()) {
                        Label(RecordingActivityText.resume, systemImage: "record.circle")
                            .font(.headline)
                            .foregroundStyle(Palette.textPrimary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                            .frame(maxWidth: .infinity, minHeight: Self.minHeight)
                            .background(Palette.neutralFill, in: .capsule)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// The time counts up on its own while recording, and holds still otherwise. Always `m:ss`.
private struct RecordingElapsedTime: View {
    let state: RecordingActivityState
    /// The widest time to make room for. A timer otherwise takes all the width it is offered.
    let sizingText: String

    var body: some View {
        Text(verbatim: sizingText)
            .hidden()
            .overlay(alignment: .trailing) {
                if let timerStart = state.timerStart {
                    Text(timerInterval: timerStart...Date.distantFuture, countsDown: false, showsHours: false)
                        .multilineTextAlignment(.trailing)
                } else {
                    Text(RecordingActivityText.duration(ofSeconds: state.elapsed))
                }
            }
            .monospacedDigit()
    }
}

/// The compact and minimal Dynamic Island's symbol for each status.
private struct RecordingStatusSymbol: View {
    let status: RecordingActivityState.Status

    var body: some View {
        symbol
            .accessibilityLabel(status.label)
    }

    @ViewBuilder private var symbol: some View {
        switch status {
        case .recording, .saving:
            Image(systemName: "circle.fill")
                .foregroundStyle(Palette.record)
        case .interrupted, .notRecording:
            Image(systemName: "pause.fill")
        case .saved:
            Image(systemName: "checkmark")
        case .failed:
            Image(systemName: "exclamationmark.triangle")
        }
    }
}

extension ActivityViewContext<RecordingActivityAttributes> {
    /// Past the stale date the app has stopped without ending the activity, so a recording
    /// shown as under way would be false.
    fileprivate var shownState: RecordingActivityState {
        isStale ? state.stale : state
    }
}

extension RecordingActivityState {
    fileprivate static let previewRecording = RecordingActivityState(
        status: .recording, timerStart: .now.addingTimeInterval(-42), elapsed: 42, canResume: false,
        bars: [0, 1, 3, 5, 8, 6, 4, 2, 5, 7])
    fileprivate static let previewInterrupted = RecordingActivityState(
        status: .interrupted, timerStart: nil, elapsed: 42, canResume: true, bars: flatBars)
    fileprivate static let previewSaving = RecordingActivityState(
        status: .saving, timerStart: nil, elapsed: 42, canResume: false, bars: flatBars)
    fileprivate static let previewSaved = RecordingActivityState(
        status: .saved, timerStart: nil, elapsed: 42, canResume: false, bars: flatBars)
    fileprivate static let previewFailed = RecordingActivityState(
        status: .failed, timerStart: nil, elapsed: 42, canResume: false, bars: flatBars)
    fileprivate static let previewNotRecording = previewRecording.stale
}

#Preview("Lock screen", as: .content, using: RecordingActivityAttributes()) {
    RecordingActivityWidget()
} contentStates: {
    RecordingActivityState.previewRecording
    RecordingActivityState.previewInterrupted
    RecordingActivityState.previewSaving
    RecordingActivityState.previewSaved
    RecordingActivityState.previewFailed
    RecordingActivityState.previewNotRecording
}

#Preview("Dynamic Island expanded", as: .dynamicIsland(.expanded), using: RecordingActivityAttributes()) {
    RecordingActivityWidget()
} contentStates: {
    RecordingActivityState.previewRecording
    RecordingActivityState.previewInterrupted
    RecordingActivityState.previewFailed
    RecordingActivityState.previewNotRecording
}

#Preview("Dynamic Island compact", as: .dynamicIsland(.compact), using: RecordingActivityAttributes()) {
    RecordingActivityWidget()
} contentStates: {
    RecordingActivityState.previewRecording
    RecordingActivityState.previewInterrupted
    RecordingActivityState.previewSaved
    RecordingActivityState.previewNotRecording
}
