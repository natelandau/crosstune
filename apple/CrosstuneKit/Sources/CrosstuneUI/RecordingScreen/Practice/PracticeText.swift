/// Words the practice view and its loops show.
public enum PracticeText {
    public static let practice = "Practice"
    public static let loopLimit = "This recording has 100 loops."
    public static let loopHint = "Drag here to mark a loop, or play and tap A B."
    public static let markLoop = "Mark loop"
    /// A B's face, which VoiceOver reads as ``markLoop`` instead.
    public static let markFace = "A B"
    /// A B's face while a start is marked.
    public static let markPendingFace = "A…"
    public static let repeatLabel = "Repeat"
    public static let repeatNeedsLoop = "Select a loop first"
    public static let repeatingTag = "Repeating"
    public static let newLoop = "New loop"
    public static let fit = "Fit"
    public static let loopStartMarked = "Loop start marked"
    public static let loopCreated = "Loop created"
    public static let loopDeleted = "Loop deleted"
    public static let undo = "Undo"
    public static let delete = "Delete"
    public static let rename = "Rename"
    public static let loopName = "Loop name"
    public static let suggestions = "Suggestions"
    public static let loops = "Loops"
    public static let waveform = "Waveform"
    public static let loopStart = "Loop start"
    public static let loopEnd = "Loop end"
    public static let laterBySecond = "Later by 1 second"
    public static let earlierBySecond = "Earlier by 1 second"
    public static let loopNotSaved = "The loop could not be saved."
    /// The undo action names the Edit menu shows: "Undo Move Loop".
    public static let undoCreate = "New Loop"
    public static let undoMove = "Move Loop"
    public static let undoRename = "Rename Loop"
    public static let undoDelete = "Delete Loop"
    /// The keys Practice answers, shown beside the loop list on iPad and Mac.
    public static let shortcutHint =
        "Space plays and pauses. R repeats. [ and ] mark a loop at the playhead. Delete removes the selected loop and Return names it."

    /// The default name of an unlabeled loop, from its offset into the trim as `m:ss`.
    static func loopName(_ time: String) -> String { "Loop \(time)" }

    /// `Repeating B part`, the loop the player repeats while Practice is closed.
    public static func repeating(_ name: String) -> String { "Repeating \(name)" }

    /// `0:58 – 1:51`, a loop's range on the trimmed timeline.
    static func range(startMs: Int64, endMs: Int64) -> String {
        "\(RecordingText.duration(milliseconds: startMs) ?? "") – \(RecordingText.duration(milliseconds: endMs) ?? "")"
    }

    /// `B part start, 0:58.3`, a handle's place on the trimmed timeline to the tenth of a second.
    static func handle(_ name: String, edge: String, time: String) -> String {
        "\(name) \(edge), \(time)"
    }
}
