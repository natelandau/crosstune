import ActivityKit
import CrosstunePalette
import CrosstuneRecordingActivity
import SwiftUI
import WidgetKit

/// The Live Activity for a recording under way: the lock screen and the Dynamic Island.
struct RecordingActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            RecordingLockScreen(state: context.shownState)
                .padding()
        } dynamicIsland: { context in
            let state = context.shownState
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RecordingStatusIcon(status: state.status)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    RecordingElapsedTime(state: state, sizingText: "00:00")
                        .font(.title2.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.center) {
                    // The failure's message is too long for the center, so it goes below.
                    if state.status != .failed {
                        Text(state.status.label)
                            .font(.headline)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if state.status == .failed {
                        RecordingFailedMessage()
                    } else {
                        RecordingActivityButtons(state: state)
                    }
                }
            } compactLeading: {
                RecordingStatusIcon(status: state.status)
            } compactTrailing: {
                if state.status != .saving && state.status != .failed {
                    // Past 100 minutes this can clip: more room costs island width on every recording.
                    RecordingElapsedTime(state: state, sizingText: "00:00")
                }
            } minimal: {
                RecordingStatusIcon(status: state.status)
            }
        }
    }
}

/// One row: the buttons, the status, and the time. A failure's message wraps below the row.
private struct RecordingLockScreen: View {
    let state: RecordingActivityState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                RecordingActivityButtons(state: state)
                RecordingStatusCapsule(status: state.status)
                Spacer(minLength: 0)
                RecordingElapsedTime(state: state, sizingText: "00:00")
                    .font(.largeTitle.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            if state.status == .failed {
                RecordingFailedMessage()
            }
        }
    }
}

private struct RecordingFailedMessage: View {
    var body: some View {
        Text(RecordingActivityText.saveFailed)
            .font(.subheadline)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The status in a capsule: record red while recording, a neutral fill otherwise.
private struct RecordingStatusCapsule: View {
    let status: RecordingActivityState.Status

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: status.systemImage)
            // The failure's message shows in full below the row.
            if status != .failed {
                Text(status.label)
                    .textCase(.uppercase)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .font(.caption.weight(.bold))
        // White text on record is an owner-approved exception to the 4.5:1 rule, for this
        // capsule only, to match the recording icon. Elsewhere a label on record is `onRecord`.
        .foregroundStyle(Palette.onAccentFill)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(status == .recording ? Palette.record : Palette.neutralFill, in: .capsule)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(status.label)
    }
}

/// Stop, and Resume after an interruption that allows it, as round outlined buttons.
private struct RecordingActivityButtons: View {
    static let size: CGFloat = 44

    let state: RecordingActivityState

    var body: some View {
        if state.status == .recording || state.status == .interrupted {
            HStack(spacing: 12) {
                Button(intent: StopRecordingIntent()) {
                    RoundButtonLabel(title: RecordingActivityText.stop, systemImage: "stop.fill")
                }
                .buttonStyle(.plain)
                if state.canResume {
                    Button(intent: ResumeRecordingIntent()) {
                        RoundButtonLabel(title: RecordingActivityText.resume, systemImage: "play.fill")
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct RoundButtonLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .labelStyle(.iconOnly)
            .font(.title3)
            .foregroundStyle(Palette.textPrimary)
            .frame(width: RecordingActivityButtons.size, height: RecordingActivityButtons.size)
            .overlay {
                Circle().strokeBorder(Palette.textPrimary, lineWidth: 2)
            }
            .contentShape(.circle)
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

/// The recording icon while recording, and the status symbol otherwise.
private struct RecordingStatusIcon: View {
    let status: RecordingActivityState.Status

    var body: some View {
        if status == .recording {
            RecordingIcon()
        } else {
            RecordingStatusSymbol(status: status)
        }
    }
}

/// A symbol for each status other than recording, which shows ``RecordingIcon``.
private struct RecordingStatusSymbol: View {
    let status: RecordingActivityState.Status

    var body: some View {
        Image(systemName: status.systemImage)
            .foregroundStyle(status == .saving ? Palette.record : Palette.textPrimary)
            .accessibilityLabel(status.label)
    }
}

extension RecordingActivityState.Status {
    fileprivate var systemImage: String {
        switch self {
        case .recording: "waveform"
        case .saving: "circle.fill"
        case .interrupted, .notRecording: "pause.fill"
        case .saved: "checkmark"
        case .failed: "exclamationmark.triangle"
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
        status: .recording, timerStart: .now.addingTimeInterval(-42), elapsed: 42, canResume: false)
    fileprivate static let previewInterrupted = RecordingActivityState(
        status: .interrupted, timerStart: nil, elapsed: 42, canResume: true)
    fileprivate static let previewSaving = RecordingActivityState(
        status: .saving, timerStart: nil, elapsed: 42, canResume: false)
    fileprivate static let previewSaved = RecordingActivityState(
        status: .saved, timerStart: nil, elapsed: 42, canResume: false)
    fileprivate static let previewFailed = RecordingActivityState(
        status: .failed, timerStart: nil, elapsed: 42, canResume: false)
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
    RecordingActivityState.previewSaving
    RecordingActivityState.previewSaved
    RecordingActivityState.previewFailed
    RecordingActivityState.previewNotRecording
}

#Preview("Dynamic Island compact", as: .dynamicIsland(.compact), using: RecordingActivityAttributes()) {
    RecordingActivityWidget()
} contentStates: {
    RecordingActivityState.previewRecording
    RecordingActivityState.previewInterrupted
    RecordingActivityState.previewSaving
    RecordingActivityState.previewSaved
    RecordingActivityState.previewFailed
    RecordingActivityState.previewNotRecording
}
