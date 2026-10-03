import CrosstuneStore

/// Words for the Play first setting.
public enum PlayFirstText {
    public static let label = "Play first"
    public static let help = "Which version plays when a tune has both and none is pinned."
    /// A choice's name in the picker, by its stored value.
    public static let names: [String: String] = [
        UserSettings.playFirstRecordings: "Recordings",
        UserSettings.playFirstAppleMusic: "Apple Music",
    ]
}
