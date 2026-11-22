/// The share extension's words.
public enum ShareText {
    public static let title = "Add to Crosstune"
    public static let save = "Save"
    public static let cancel = "Cancel"
    public static let searchPrompt = "Search tunes"
    public static let signedOut = "Open Crosstune and sign in to add links and recordings."
    public static let savedLink = "Link saved. It's added to the tune the next time Crosstune opens."
    public static let nothingToShare = "Crosstune can add a link or an audio file."
    public static let saveFailed = "Crosstune could not save this. Try again."
    public static let tooManyFiles = "Crosstune can add up to \(ShareSheetModel.maxAudioFiles) files at a time."

    /// The row that makes a tune named `title`.
    public static func newTune(_ title: String) -> String {
        "New tune \"\(title)\""
    }

    public static func savedRecordings(_ count: Int) -> String {
        count == 1 ? "Saved to Recordings." : "Saved \(count) recordings."
    }
}
