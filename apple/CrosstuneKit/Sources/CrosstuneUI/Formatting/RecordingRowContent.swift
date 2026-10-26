import CrosstuneStore
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
        /// Opens the recording's practice view, loading it paused when the player holds another.
        case open
        case download
        /// A stuck row with nothing to play retries, so the row still answers a tap.
        case retry(RecordingText.Retry)
        /// The plan holds recordings back, so the tap offers Premium in place of a play, an
        /// open, or a download.
        case premium
    }

    public let glyph: MediaGlyph
    public let title: String
    /// The second line's parts joined with middle dots.
    public let meta: String
    /// What the row is doing or would do, spoken before its title: "Play", "Downloading".
    public let actionLabel: String?
    /// What a tap does, or nil when the row is inert.
    public let tap: Tap?
    public let control: RecordingText.Control
    public let retry: RecordingText.Retry?
    /// Retry's spoken name, "Retry uploading Jam", or nil when the row is not stuck.
    public let retryName: String?
    /// The red third line: why a stuck upload was refused, or that the last download this row
    /// asked for fetched nothing.
    public let error: String?
    /// Reads dimmed: a download that cannot start offline or a play while a recording is recorded,
    /// each of which keeps its name and tap, and any recording the plan holds back, whose tap
    /// offers Premium.
    public let isDimmed: Bool
    /// Why a dimmed play does nothing, under the second line.
    public let notice: String?
    /// What a tap offers in place of the row's own action, spoken after the row's lines and
    /// never shown: Premium, for a recording the plan holds back.
    public let spokenNotice: String?

    /// Whether a row offering `control` is disabled while a recording is under way: only a play does.
    nonisolated static func blocksPlay(_ control: RecordingText.Control) -> Bool {
        control == .play
    }

    /// Whether a recording's row would say Stop recording to play while a recording is under way.
    nonisolated static func blocksPlay(
        _ recording: Recording, file: RecordingFile?, loaded: Bool, downloading: Bool
    ) -> Bool {
        blocksPlay(RecordingText.control(recording, file: file, loaded: loaded, downloading: downloading))
    }

    public init(
        recording: Recording, file: RecordingFile?, tuneTitle: String?, tuneNamedAbove: Bool = false,
        loaded: Bool = false, downloading: Bool = false, downloadFailed: Bool = false, offline: Bool = false,
        playBlocked: Bool = false, storage: StorageUsage? = nil, sort: RecordingSort? = nil,
        opensScreen: Bool = false, isLocalUntilSubscribed: Bool = false, recordingsPlay: Bool = true,
        locale: Locale = .current, timeZone: TimeZone = .current
    ) {
        let title = RecordingText.title(
            recording, tuneTitle: tuneTitle, tuneNamedAbove: tuneNamedAbove, locale: locale, timeZone: timeZone)
        self.title = title
        control = RecordingText.control(recording, file: file, loaded: loaded, downloading: downloading)
        let offlineDownload = control == .download && offline
        meta = RecordingText.meta(
            recording, file: file, storage: storage, offline: offlineDownload,
            dateInTitle: RecordingText.titleIsDate(recording, tuneTitle: tuneTitle, tuneNamedAbove: tuneNamedAbove),
            // A row stays local-only until the next push, but a Premium plan sends the recording on it.
            sort: sort, isLocalUntilSubscribed: isLocalUntilSubscribed && !recordingsPlay, locale: locale,
            timeZone: timeZone
        ).joined(separator: " · ")
        let blockedPlay = playBlocked && Self.blocksPlay(control)
        isDimmed = offlineDownload || blockedPlay || !recordingsPlay
        notice = blockedPlay ? MediaText.stopRecordingToPlay : nil
        retry = RecordingText.retry(recording, file: file)
        let retryActionLabel: String? =
            switch retry {
            case .upload: Self.retryUploading
            case .transcode: MediaText.retry
            case nil: nil
            }
        retryName = retryActionLabel.map { "\($0) \(title)" }
        // A failed download matters only while the row still offers one: audio fetched since,
        // by the download pass or a play, has answered it.
        error =
            (retry == .upload ? file?.error : nil)
            ?? (downloadFailed && control == .download ? RecordingText.downloadFailed : nil)
        let shownActionLabel: String?
        let shown: Tap?
        switch control {
        // A row that opens the practice view opens it whether or not the player holds it.
        case .play where opensScreen, .close where opensScreen:
            (glyph, shownActionLabel, shown) = (.play, MediaText.open, .open)
        case .play: (glyph, shownActionLabel, shown) = (.play, MediaText.play, .play)
        case .close: (glyph, shownActionLabel, shown) = (.stop, MediaText.closePlayer, .close)
        case .download: (glyph, shownActionLabel, shown) = (.download, Self.download, .download)
        case .downloading: (glyph, shownActionLabel, shown) = (.downloading, RecordingText.downloading, nil)
        case .none:
            if let retry {
                (glyph, shownActionLabel, shown) = (.attention, retryActionLabel, .retry(retry))
            } else {
                (glyph, shownActionLabel, shown) = (.waiting, nil, nil)
            }
        }
        let gated: Bool
        switch shown {
        case .play?, .close?, .open?, .download?: gated = !recordingsPlay
        case .retry?, .premium?, nil: gated = false
        }
        // A gated tap opens the Plan sheet, so the row offers a subscription rather than the play.
        tap = gated ? .premium : shown
        actionLabel = gated ? nil : shownActionLabel
        spokenNotice = gated ? RecordingText.subscribeToPlay : nil
    }
}
