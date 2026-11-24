import CrosstuneRecordingActivity
import CrosstuneVocabulary
import Foundation

/// Everything the widgets show for one user. The app writes it; the widgets only read it.
public struct WidgetSummary: Codable, Hashable, Sendable {
    /// The most recordings the summary carries, newest first.
    public static let maxRecordings = 5

    /// True when the user may play recordings from a widget.
    public var recordingsPlay: Bool
    public var recordings: [WidgetRecording]
    public var lists: [WidgetList]
    /// The tuner's reference pitch as the tuner screen shows it, or nil at the standard pitch.
    public var tunerReferenceLabel: String?
    /// The recording in progress, or nil when none is.
    public var recording: RecordingActivityState?
    /// Set while recording. Past it, the app stopped sending updates, so the widget shows
    /// ``RecordingActivityState/stale`` in place of a time that would count up forever.
    public var recordingFreshUntil: Date?
    /// The list playing or paused now, or nil when none is.
    public var listPlayback: WidgetListPlayback?

    public init(
        recordingsPlay: Bool, recordings: [WidgetRecording], lists: [WidgetList], tunerReferenceLabel: String?,
        recording: RecordingActivityState?, recordingFreshUntil: Date?, listPlayback: WidgetListPlayback?
    ) {
        self.recordingsPlay = recordingsPlay
        self.recordings = recordings
        self.lists = lists
        self.tunerReferenceLabel = tunerReferenceLabel
        self.recording = recording
        self.recordingFreshUntil = recordingFreshUntil
        self.listPlayback = listPlayback
    }

    // The file outlives an app update, so a field added later decodes with a default when a
    // file the earlier app wrote lacks it. Optional fields default to nil without this.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        recordingsPlay = try container.decode(Bool.self, forKey: .recordingsPlay)
        recordings = try container.decodeIfPresent([WidgetRecording].self, forKey: .recordings) ?? []
        lists = try container.decodeIfPresent([WidgetList].self, forKey: .lists) ?? []
        tunerReferenceLabel = try container.decodeIfPresent(String.self, forKey: .tunerReferenceLabel)
        recording = try container.decodeIfPresent(RecordingActivityState.self, forKey: .recording)
        recordingFreshUntil = try container.decodeIfPresent(Date.self, forKey: .recordingFreshUntil)
        listPlayback = try container.decodeIfPresent(WidgetListPlayback.self, forKey: .listPlayback)
    }

    /// What the summary shows at `date`: a recording past its fresh-until date shows as stale,
    /// since the app stopped updating it.
    public func expired(at date: Date) -> WidgetSummary {
        var shown = self
        if let recording, let recordingFreshUntil, recordingFreshUntil <= date {
            shown.recording = recording.stale
        }
        return shown
    }

    /// What stays true once the app has ended: no list plays, and only a recording under way,
    /// which expires on its own, is kept. A paused list or an interrupted recording can sit
    /// unchanged for any time while the app is suspended, so those have no expiry and go here.
    public var afterAppEnded: WidgetSummary {
        let ended = withoutListPlayback
        return recording?.status == .recording ? ended : ended.withoutRecording
    }

    /// The summary with no list playing or paused, for when the app holds no list playback.
    public var withoutListPlayback: WidgetSummary {
        var cleared = self
        cleared.listPlayback = nil
        return cleared
    }

    /// The summary with no recording state, for when the app holds no recording under way.
    public var withoutRecording: WidgetSummary {
        var cleared = self
        cleared.recording = nil
        cleared.recordingFreshUntil = nil
        return cleared
    }
}

/// What the widgets can show for whoever is signed in.
public enum CurrentWidgetSummary: Equatable, Sendable {
    case signedOut
    /// Someone is signed in, but the app has written no summary yet or it does not decode.
    case unavailable
    case available(WidgetSummary)
}

public struct WidgetRecording: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let isUnfiled: Bool
    /// When the music was played, or when the recording was added when that is unknown.
    public let recordedAt: Date
    /// How much of ``recordedAt`` is known. A recording added with no recorded date is `.time`.
    public let recordedPrecision: RecordingPrecision
    /// Nil until the length is known, such as before an upload is processed.
    public let duration: TimeInterval?

    public init(
        id: String, title: String, isUnfiled: Bool, recordedAt: Date, recordedPrecision: RecordingPrecision,
        duration: TimeInterval?
    ) {
        self.id = id
        self.title = title
        self.isUnfiled = isUnfiled
        self.recordedAt = recordedAt
        self.recordedPrecision = recordedPrecision
        self.duration = duration
    }
}

public struct WidgetList: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let tunes: [WidgetListTune]

    public init(id: String, name: String, tunes: [WidgetListTune]) {
        self.id = id
        self.name = name
        self.tunes = tunes
    }
}

public struct WidgetListTune: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let title: String
    /// A second line the app builds, such as "D · Reel · AEAE".
    public let detail: String?

    public init(id: String, title: String, detail: String?) {
        self.id = id
        self.title = title
        self.detail = detail
    }
}

/// Where list playback stands, so a widget shows the current tune and the controls that apply.
public struct WidgetListPlayback: Codable, Hashable, Sendable {
    public let listID: String
    public let currentTuneID: String
    public let isPlaying: Bool
    /// The current tune's place in the list, counting from 1.
    public let position: Int
    public let count: Int
    public let nextTuneID: String?

    public init(
        listID: String, currentTuneID: String, isPlaying: Bool, position: Int, count: Int, nextTuneID: String?
    ) {
        self.listID = listID
        self.currentTuneID = currentTuneID
        self.isPlaying = isPlaying
        self.position = position
        self.count = count
        self.nextTuneID = nextTuneID
    }
}
