/// The tune a shared link is saved to.
public enum ShareChoice: Hashable, Sendable {
    case tune(ShareTuneEntry)
    /// A new tune titled with the search text.
    case newTune
}
