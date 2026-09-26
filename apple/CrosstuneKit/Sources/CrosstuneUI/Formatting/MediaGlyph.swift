/// What the leading slot of a recording or link row shows: the item's state.
public enum MediaGlyph: Hashable, Sendable {
    case play
    case stop
    case download
    case downloading
    /// Stuck until the musician retries.
    case attention
    /// Waiting on something outside the musician's hands, such as the server processing.
    case waiting
    case none
}

/// Words recording and link rows share.
public enum MediaText {
    public static let play = "Play"
    public static let closePlayer = "Close player"
    public static let retry = "Retry"
    /// Why a play tap does nothing while a take is being recorded.
    public static let stopRecordingToPlay = "Stop recording to play"
}
