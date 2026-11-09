import CrosstuneDesign
import CrosstuneStore
import CrosstuneSync
import Foundation

/// Words the recording screen and its tools show.
public enum RecordingScreenText {
    public static let trim = "Trim"
    public static let speed = "Speed"
    /// The Mac's segmented speed presets, for VoiceOver.
    public static let speedPresets = "Speed presets"
    public static let pitch = "Pitch"
    public static let reset = ValueSlider.resetName
    public static let semitones = "Semitones"
    public static let cents = "Cents"
    public static let trimBusy = "Trimming…"
    public static let trimWhileRecording = "Still recording"
    public static let trimWhileDownloading = RecordingText.downloading
    public static let speedNotSaved = "The speed could not be saved."
    public static let pitchNotSaved = "The pitch could not be saved."
    public static let isolateNotSaved = "The isolate setting could not be saved."
    public static let isolate = "Isolate"
    public static let solo = "Solo"
    public static let mute = "Mute"
    /// The Solo and Mute choice, for VoiceOver.
    public static let isolateEffect = "Effect"
    public static let stereo = "Stereo"
    public static let frequency = "Frequency"
    public static let monoNotice = "This recording is mono, so only frequency applies."
    public static let stereoStart = "Stereo start"
    public static let stereoEnd = "Stereo end"
    public static let frequencyLow = "Frequency low"
    public static let frequencyHigh = "Frequency high"
    /// VoiceOver actions that move a stereo or frequency edge by its large step.
    public static let stereoRightLarge = "Right by 20"
    public static let stereoLeftLarge = "Left by 20"
    public static let frequencyUpLarge = "Up an octave"
    public static let frequencyDownLarge = "Down an octave"
    public static let isolateUnavailable = "Isolate isn't available here"
    /// `35 left` and `35 right`, a stereo edge's place off center.
    public static func stereoLeftBy(_ units: Int) -> String { "\(units) left" }
    public static func stereoRightBy(_ units: Int) -> String { "\(units) right" }
    /// The stereo readout's words: where the range sits, then how wide it is.
    public static let stereoCenter = "Center"
    public static let stereoLeft = "Left"
    public static let stereoRight = "Right"
    public static let stereoLeftOfCenter = "Left of center"
    public static let stereoRightOfCenter = "Right of center"
    public static let stereoNarrow = "narrow"
    public static let stereoMedium = "medium"
    public static let stereoWide = "wide"
    /// A stereo range that keeps the whole picture.
    public static let stereoEverything = "Everything"
    public static let cancel = "Cancel"
    public static let save = "Save"
    public static let playSelection = "Play selection"
    public static let previewEnd = "Preview end"
    public static let zoomIn = ZoomControl.zoomIn
    public static let zoomOut = ZoomControl.zoomOut
    public static let startHandle = RangeHandles.startName
    public static let endHandle = RangeHandles.endName
    public static let length = "Length"
    public static let trimNotSaved = "The trim could not be saved."
    public static let trimChangedElsewhere = "This recording's trim changed elsewhere."
    public static let trimConfirmMessage = "This can't be undone."
    public static let trimConfirmAction = "Trim"

    public static let split = "Split"
    public static let removeCut = "Remove cut"
    public static let pieceMinHint = "Each piece must be at least 1 second long"
    public static let pieceMaxHint = "This piece is too long to upload. Add a cut to shorten it."
    public static let previousCut = "Previous cut"
    public static let nextCut = "Next cut"
    public static let splitConfirmMessage = "This can't be undone."
    public static let splitConfirmAction = "Split"
    public static let splitBusy = "Still processing"
    public static let deleteWhileSplitting = "Wait for the split to finish"

    /// `Split at 9:12`, the time the cut lands.
    public static func splitAt(milliseconds: Int64) -> String {
        "Split at \(RecordingText.duration(of: milliseconds))"
    }

    /// `Cut 2`, a cut's handle on the zoomed strip.
    public static func cutHandle(_ number: Int) -> String {
        "Cut \(number)"
    }

    /// `Piece 2 of 3`.
    public static func pieceOf(_ number: Int, count: Int) -> String {
        "Piece \(number) of \(count)"
    }

    /// `Split into 3 recordings?`
    public static func splitConfirmTitle(count: Int) -> String {
        "Split into \(count) recordings?"
    }

    /// `Trim to 3:12?`, the length the recording keeps.
    public static func trimConfirmTitle(milliseconds: Int64) -> String {
        "Trim to \(RecordingText.duration(milliseconds: milliseconds) ?? "")?"
    }

    /// `m:ss.t`, for placing a trim handle to the tenth of a second.
    public static func preciseTime(milliseconds: Int64) -> String {
        RangeEdit.tenthsText(Int64((Double(max(0, milliseconds)) / 100).rounded()))
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

    /// Why the waveform, transport, and modes cannot be used now, or nil when they can: the recording
    /// is still being recorded, or its audio is downloading. A pending trim does not touch them,
    /// so it does not block.
    static func screenUnavailableReason(file: RecordingFile?, downloading: Bool) -> String? {
        if file?.localState == .capturing { return trimWhileRecording }
        if downloading || file?.localState == .downloading { return trimWhileDownloading }
        return nil
    }

    /// Why a recording the player does not hold cannot load and play now, or nil when Play would
    /// load it: still being recorded or downloaded, not on this device while offline, or with no
    /// audio ready anywhere yet, as while another device uploads it, which its row's state says.
    static func loadUnavailableReason(
        _ recording: Recording, file: RecordingFile?, downloading: Bool, offline: Bool
    ) -> String? {
        if let reason = screenUnavailableReason(file: file, downloading: downloading) { return reason }
        return switch RecordingText.control(recording, file: file, loaded: false, downloading: downloading) {
        case .play, .close: nil
        case .download: offline ? SyncStatus.offlineLabel : nil
        case .downloading: RecordingText.downloading
        case .none: RecordingText.fileState(recording, file: file) ?? RecordingText.processing
        }
    }

    /// Why Trim cannot be used now, or nil when it can: the recording is still being recorded, its
    /// audio is not here yet, or the server has yet to cut the last trim.
    static func trimDisabledReason(
        _ recording: Recording, file: RecordingFile?, audio: RecordingAudio?, offline: Bool = false
    ) -> String? {
        if file?.localState == .capturing { return trimWhileRecording }
        if audio == .fetching || file?.localState == .downloading { return trimWhileDownloading }
        if audio == .unavailable { return offline ? SyncStatus.offlineLabel : RecordingText.downloadFailed }
        if trimPending(recording) { return trimBusy }
        return nil
    }

    /// Why Split cannot be used now, or nil when it can: Trim's reasons first, then a split of
    /// the row still being cut, or the row being a piece the server has not cut yet.
    static func splitDisabledReason(
        _ recording: Recording, file: RecordingFile?, audio: RecordingAudio?, offline: Bool = false
    ) -> String? {
        if let reason = trimDisabledReason(recording, file: file, audio: audio, offline: offline) { return reason }
        if RecordingLimits.splitIncomplete(recording) { return splitBusy }
        if RecordingLimits.waitsForCut(recording) { return splitBusy }
        return nil
    }

    /// Why Delete cannot be used now, or nil when it can: a piece split from the recording still
    /// waits for its cut and plays from its audio.
    static func deleteDisabledReason(_ view: RecordingView) -> String? {
        view.holdsSplitAudio ? deleteWhileSplitting : nil
    }

    /// True while a ready recording's playback file does not match its trim yet, when a
    /// second trim would race the one queued.
    static func trimPending(_ recording: Recording) -> Bool {
        guard recording.state == "ready", let start = recording.playbackStartMs, let end = recording.playbackEndMs
        else { return false }
        return recording.trimStartMs != start || (recording.trimEndMs ?? recording.sourceDurationMs) != end
    }
}
