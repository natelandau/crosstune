import CrosstuneStore
import CrosstuneSync
import Foundation

/// How a recording reads in its row: title, metadata, and what its leading control does.
public enum RecordingText {
    public static let recording = "Recording"
    public static let waitingToUpload = "Waiting to upload"
    public static let uploading = "Uploading"
    public static let storageFull = "Storage full"
    public static let uploadFailed = "Upload failed"
    public static let downloading = "Downloading"
    public static let downloadFailed = "Couldn't download"
    public static let processing = "Processing"
    public static let processFailed = "Couldn't process"

    /// What the row's leading control does.
    public enum Control: Equatable, Sendable {
        case play
        case close
        case download
        case downloading
        case none
    }

    /// Which retry a stuck recording needs.
    public enum Retry: Equatable, Sendable {
        case upload
        case transcode
    }

    /// `m:ss`, rounded to the nearest second. Nil when the length is unknown.
    public static func duration(milliseconds: Int64?) -> String? {
        guard let milliseconds else { return nil }
        let total = Int64((Double(milliseconds) / 1000).rounded())
        let seconds = total % 60
        return "\(total / 60):\(seconds < 10 ? "0" : "")\(seconds)"
    }

    /// How many times in a row an upload has failed, as `2 failed tries`.
    public static func failedTries(_ count: Int) -> String {
        "\(count) failed \(count == 1 ? "try" : "tries")"
    }

    /// A size in decimal units. Megabytes and gigabytes truncate to a tenth, so a shown size
    /// never overstates what is there.
    public static func bytes(_ bytes: Int64) -> String {
        if bytes < 1000 { return "\(bytes) B" }
        if bytes < 1_000_000 { return "\(Int64((Double(bytes) / 1000).rounded())) KB" }
        let (divisor, unit): (Int64, String) = bytes < 1_000_000_000 ? (1_000_000, "MB") : (1_000_000_000, "GB")
        let tenths = bytes * 10 / divisor
        let (whole, fraction) = tenths.quotientAndRemainder(dividingBy: 10)
        return fraction == 0 ? "\(whole) \(unit)" : "\(whole).\(fraction) \(unit)"
    }

    /// When the recording was made, as a medium date and short time.
    public static func recordedAt(_ time: Timestamp, locale: Locale = .current, timeZone: TimeZone = .current)
        -> String
    {
        time.date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened, locale: locale, timeZone: timeZone))
    }

    /// The most specific name available: the recording's label, then its tune's title, then when
    /// it was made. Under a heading that already names the tune, the tune is skipped.
    public static func title(
        _ recording: Recording, tuneTitle: String?, tuneNamedAbove: Bool = false, locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        if let label = recording.label { return label }
        if !tuneNamedAbove, let tuneTitle { return tuneTitle }
        return "\(Self.recording), \(recordedAt(recording.recordedAt, locale: locale, timeZone: timeZone))"
    }

    /// What to tell the musician about a recording that is not simply playable. Nil when it is.
    public static func fileState(_ recording: Recording, file: RecordingFile?) -> String? {
        switch file?.localState {
        case .capturing: return Self.recording
        case .captured: return waitingToUpload
        case .uploading: return uploading
        case .blockedQuota: return storageFull
        case .failedUpload: return uploadFailed
        case .downloading: return downloading
        case .uploaded, .downloaded, nil: break
        }
        switch recording.state {
        case "uploaded", "processing": return processing
        case "failed": return processFailed
        default: return nil
        }
    }

    /// The parts of the row's second line, in order, for joining with middle dots. A recording
    /// that needs nothing shows when it was made in place of a status. `offline` marks a
    /// download that cannot start, and replaces the status. The file's own length stands in
    /// until the server reports the recording's.
    public static func meta(
        _ recording: Recording, file: RecordingFile?, storage: StorageFigures? = nil, offline: Bool = false,
        locale: Locale = .current, timeZone: TimeZone = .current
    ) -> [String] {
        let length = duration(milliseconds: recording.durationMs ?? file?.localDurationMs)
        if offline { return [length, SyncStatus.offlineLabel].compactMap { $0 } }
        let status =
            fileState(recording, file: file)
            ?? recordedAt(recording.recordedAt, locale: locale, timeZone: timeZone)
        let waiting = file?.localState == .captured || file?.localState == .uploading
        let attempts = file?.uploadAttempts ?? 0
        let tries = waiting && attempts > 0 ? failedTries(attempts) : nil
        var storageUsed: String?
        if file?.localState == .blockedQuota, let storage {
            storageUsed =
                "\(bytes(Int64(storage.usedBytes))) of \(bytes(Int64(storage.quotaBytes))) used"
        }
        return [length, status, tries, storageUsed].compactMap { $0 }
    }

    /// Whether this device holds audio it can play. A capture still being written is not
    /// playable yet.
    public static func holdsAudio(_ file: RecordingFile?) -> Bool {
        guard let file, file.fileName != nil else { return false }
        return file.localState != .capturing && file.localState != .downloading
    }

    /// Which control the row shows. Close beats play for a loaded item even after its audio is
    /// gone; play needs audio on this device; download belongs to the server's ready copy.
    public static func control(_ recording: Recording, file: RecordingFile?, loaded: Bool, downloading: Bool)
        -> Control
    {
        if loaded { return .close }
        if holdsAudio(file) { return .play }
        // Without a ready copy on the server there is nothing to fetch, so a stale downloading
        // state stops short of the spinner and leaves the row free to offer Retry.
        guard recording.state == "ready" else { return .none }
        return downloading || file?.localState == .downloading ? .downloading : .download
    }

    /// Which retry a stuck row needs, or nil when it is not stuck. An upload is stuck once it is
    /// refused, or while the transfer loop keeps failing to send it.
    public static func retry(_ recording: Recording, file: RecordingFile?) -> Retry? {
        if file?.localState == .failedUpload { return .upload }
        if file?.localState == .captured, (file?.uploadAttempts ?? 0) > 0 { return .upload }
        if recording.state == "failed" { return .transcode }
        return nil
    }
}
