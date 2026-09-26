import CrosstuneStore
import CrosstuneSync
import Foundation

/// Everything a recording's row shows, worked out from the recording, its local file, and
/// whether the player holds it.
public struct RecordingRowContent: Hashable, Sendable {
    public static let download = "Download"
    public static let retryUploading = "Retry uploading"

    /// What a tap on the row does.
    public enum Tap: Hashable, Sendable {
        case play
        case close
        case download
        /// A stuck row with nothing to play retries, so the row still answers a tap.
        case retry(RecordingText.Retry)
    }

    public let glyph: MediaGlyph
    public let title: String
    /// The second line's parts joined with middle dots.
    public let meta: String
    /// What the row is doing or would do, spoken before its title: "Play", "Downloading".
    public let verb: String?
    /// What a tap does, or nil when the row is inert.
    public let tap: Tap?
    public let control: RecordingText.Control
    public let retry: RecordingText.Retry?
    /// Retry's spoken name, "Retry uploading Jam", or nil when the row is not stuck.
    public let retryName: String?
    /// The red third line: why a stuck upload was refused, or that the last download this row
    /// asked for fetched nothing.
    public let error: String?
    /// A download that cannot start offline, or a play while a take is recorded, keeps its name
    /// and tap but reads dimmed.
    public let isDimmed: Bool
    /// Why a dimmed play does nothing, under the second line.
    public let notice: String?

    public init(
        recording: Recording, file: RecordingFile?, tuneTitle: String?, tuneNamedAbove: Bool = false,
        loaded: Bool = false, downloading: Bool = false, downloadFailed: Bool = false, offline: Bool = false,
        playBlocked: Bool = false,
        storage: StorageFigures? = nil, locale: Locale = .current, timeZone: TimeZone = .current
    ) {
        let title = RecordingText.title(
            recording, tuneTitle: tuneTitle, tuneNamedAbove: tuneNamedAbove, locale: locale, timeZone: timeZone)
        self.title = title
        control = RecordingText.control(recording, file: file, loaded: loaded, downloading: downloading)
        let offlineDownload = control == .download && offline
        meta = RecordingText.meta(
            recording, file: file, storage: storage, offline: offlineDownload, locale: locale, timeZone: timeZone
        ).joined(separator: " · ")
        let blockedPlay = playBlocked && control == .play
        isDimmed = offlineDownload || blockedPlay
        notice = blockedPlay ? MediaText.stopRecordingToPlay : nil
        retry = RecordingText.retry(recording, file: file)
        let retryVerb: String? =
            switch retry {
            case .upload: Self.retryUploading
            case .transcode: MediaText.retry
            case nil: nil
            }
        retryName = retryVerb.map { "\($0) \(title)" }
        // A failed download matters only while the row still offers one: audio fetched since,
        // by the download pass or a play, has answered it.
        error =
            (retry == .upload ? file?.error : nil)
            ?? (downloadFailed && control == .download ? RecordingText.downloadFailed : nil)
        switch control {
        case .play: (glyph, verb, tap) = (.play, MediaText.play, .play)
        case .close: (glyph, verb, tap) = (.stop, MediaText.closePlayer, .close)
        case .download: (glyph, verb, tap) = (.download, Self.download, .download)
        case .downloading: (glyph, verb, tap) = (.downloading, RecordingText.downloading, nil)
        case .none:
            if let retry {
                (glyph, verb, tap) = (.attention, retryVerb, .retry(retry))
            } else {
                (glyph, verb, tap) = (.waiting, nil, nil)
            }
        }
    }
}
