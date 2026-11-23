import CrosstuneRecordingActivity
import Foundation

/// One moment of a widget's timeline: when it starts to show, and what it shows.
public struct WidgetMoment: Equatable, Sendable {
    public let date: Date
    public let current: CurrentWidgetSummary

    public init(date: Date, current: CurrentWidgetSummary) {
        self.date = date
        self.current = current
    }
}

/// Plans what a widget shows over time from the summary the app last wrote.
public enum WidgetTimeline {
    /// The moments to show from `now`: one now, and one at the recording's fresh-until date
    /// when it is still ahead, where the recording goes stale (``WidgetSummary/expired(at:)``).
    public static func moments(for current: CurrentWidgetSummary, now: Date) -> [WidgetMoment] {
        guard case .available(let summary) = current else { return [WidgetMoment(date: now, current: current)] }
        let dates = [now] + [summary.recordingFreshUntil].compactMap(\.self).filter { $0 > now }
        return dates.map { WidgetMoment(date: $0, current: .available(summary.expired(at: $0))) }
    }
}

/// What the Recordings widget's controls offer.
public enum RecordingsWidgetMode: Equatable, Sendable {
    /// The plan holds recordings back, so every tap opens the plan screen.
    case premium
    case ready
    /// A recording under way or just ended, in the Live Activity's states.
    case live(RecordingActivityState)

    /// A live recording comes first, so an account that lapses mid-recording can still stop it.
    public init(_ summary: WidgetSummary) {
        if let recording = summary.recording, recording.status != .notRecording {
            self = .live(recording)
        } else if !summary.recordingsPlay {
            self = .premium
        } else {
            self = .ready
        }
    }

    /// What the widget's main control runs at every size, or nil when the state offers none. A
    /// failed save opens the app, which says why.
    public var primaryAction: RecordingsWidgetAction? {
        switch self {
        case .premium: .openPlan
        case .ready: .record
        case .live(let state):
            switch state.status {
            case .recording, .interrupted: .stop
            case .failed: .openApp
            case .saving, .saved, .notRecording: nil
            }
        }
    }
}

/// What a Recordings widget control runs.
public enum RecordingsWidgetAction: Equatable, Sendable {
    case record
    case openPlan
    case stop
    case resume
    case openApp
}
