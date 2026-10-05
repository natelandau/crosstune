import CrosstuneStore
import CrosstuneSync
import Foundation

/// Words the recording screen and its tools show.
public enum RecordingScreenText {
    public static let close = "Close"
    public static let trim = "Trim"
    public static let speed = "Speed"
    /// The Mac's segmented speed presets, for VoiceOver.
    public static let speedPresets = "Speed presets"
    public static let pitch = "Pitch"
    public static let reset = "Reset"
    public static let slower = "Slower"
    public static let faster = "Faster"
    public static let semitones = "Semitones"
    public static let cents = "Cents"
    public static let pitchDown = "Down a semitone"
    public static let pitchUp = "Up a semitone"
    public static let trimBusy = "Trimming…"
    public static let trimWhileRecording = "Still recording"
    public static let trimWhileDownloading = RecordingText.downloading
    public static let speedNotSaved = "The speed could not be saved."
    public static let pitchNotSaved = "The pitch could not be saved."
    public static let cancel = "Cancel"
    public static let save = "Save"
    public static let setStart = "Set start"
    public static let setEnd = "Set end"
    public static let playSelection = "Play selection"
    public static let previewEnd = "Preview end"
    public static let goToStart = "Go to start"
    public static let goToEnd = "Go to end"
    public static let zoomIn = "Zoom in"
    public static let zoomOut = "Zoom out"
    public static let startHandle = "Start"
    public static let endHandle = "End"
    public static let length = "Length"
    public static let trimNotSaved = "The trim could not be saved."
    public static let trimChangedElsewhere = "This recording's trim changed elsewhere."
    public static let trimConfirmMessage = "This can't be undone."
    public static let trimConfirmAction = "Trim"

    /// `Trim to 3:12?`, the length the recording keeps.
    public static func trimConfirmTitle(milliseconds: Int64) -> String {
        "Trim to \(RecordingText.duration(milliseconds: milliseconds) ?? "")?"
    }

    /// `m:ss.t`, for placing a trim handle to the tenth of a second.
    public static func preciseTime(milliseconds: Int64) -> String {
        let tenths = Int64((Double(max(0, milliseconds)) / 100).rounded())
        let seconds = tenths % 600 / 10
        return "\(tenths / 600):\(seconds < 10 ? "0" : "")\(seconds).\(tenths % 10)"
    }

    /// `75%`, shown only away from the 100% default.
    public static func speedBadge(_ percent: Int) -> String {
        "\(percent)%"
    }

    /// Semitones with a sign, whole when the cents make whole semitones (`+2`, `-1`), else to a
    /// tenth rounded away from zero, never less than a tenth for any shift (`+0.1`, `-2.1`).
    /// Integer tenths keep 205 cents at 2.1 rather than at whatever 2.05 is stored as.
    public static func pitchBadge(_ cents: Int) -> String {
        let magnitude = abs(cents)
        let sign = cents < 0 ? "-" : "+"
        if magnitude % 100 == 0 { return "\(sign)\(magnitude / 100)" }
        let tenths = max(1, (magnitude + 5) / 10)
        return "\(sign)\(tenths / 10).\(tenths % 10)"
    }

    /// The badge for each setting away from its default, nil where it is at its default.
    public static func badges(speedPercent: Int, pitchCents: Int) -> (speed: String?, pitch: String?) {
        (
            speedPercent != 100 ? speedBadge(speedPercent) : nil,
            pitchCents != 0 ? pitchBadge(pitchCents) : nil
        )
    }

    /// The player bar's badge: "75% +2". Nil at the defaults, when no badge shows.
    public static func badge(speedPercent: Int, pitchCents: Int) -> String? {
        let parts = badges(speedPercent: speedPercent, pitchCents: pitchCents)
        let shown = [parts.speed, parts.pitch].compactMap(\.self)
        return shown.isEmpty ? nil : shown.joined(separator: " ")
    }

    /// What VoiceOver reads for a badge, naming each setting: "Speed 75%, Pitch +2". Nil at
    /// the defaults, when no badge shows.
    public static func badgeLabel(speedPercent: Int, pitchCents: Int) -> String? {
        let parts = badges(speedPercent: speedPercent, pitchCents: pitchCents)
        let named = [parts.speed.map { "\(speed) \($0)" }, parts.pitch.map { "\(pitch) \($0)" }].compactMap(\.self)
        return named.isEmpty ? nil : named.joined(separator: ", ")
    }

    /// Why the waveform, transport, and modes cannot be used now, or nil when they can: the take
    /// is still being recorded, or its audio is downloading. A pending trim does not touch them,
    /// so it does not block.
    static func screenBlocker(file: RecordingFile?, downloading: Bool) -> String? {
        if file?.localState == .capturing { return trimWhileRecording }
        if downloading || file?.localState == .downloading { return trimWhileDownloading }
        return nil
    }

    /// Why Trim cannot be used now, or nil when it can: the take is still being recorded, its
    /// audio is not here yet, or the server has yet to cut the last trim.
    static func trimBlocker(
        _ recording: Recording, file: RecordingFile?, audio: RecordingAudio?, offline: Bool = false
    ) -> String? {
        if file?.localState == .capturing { return trimWhileRecording }
        if audio == .fetching || file?.localState == .downloading { return trimWhileDownloading }
        if audio == .unavailable { return offline ? SyncStatus.offlineLabel : RecordingText.downloadFailed }
        if trimPending(recording) { return trimBusy }
        return nil
    }

    /// True while a ready recording's playback file does not match its trim yet, when a
    /// second trim would race the one queued.
    static func trimPending(_ recording: Recording) -> Bool {
        guard recording.state == "ready", let start = recording.playbackStartMs, let end = recording.playbackEndMs
        else { return false }
        return recording.trimStartMs != start || (recording.trimEndMs ?? recording.sourceDurationMs) != end
    }
}
