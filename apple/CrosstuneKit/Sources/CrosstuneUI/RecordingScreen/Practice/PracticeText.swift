/// Words the recording screen's waveform, modes, and loops show.
public enum PracticeText {
    public static let loopLimit = "This recording has 100 loops."
    public static let noRoom = "No room for a loop here."
    public static let loopsEmptyHint = "Scroll to a spot and tap New loop."
    public static let newLoop = "New loop"
    public static let previousLoop = "Previous loop"
    public static let nextLoop = "Next loop"
    public static let fit = "Fit"
    public static let loopCreated = "Loop created"
    public static let deleteLoop = "Delete loop"
    public static let noLoop = "No loop"
    public static let rename = "Rename"
    public static let loopName = "Loop name"
    public static let suggestions = "Suggestions"
    public static let loops = "Loops"
    public static let modes = "Modes"
    public static let waveform = "Waveform"
    public static let loopStart = "Loop start"
    public static let loopEnd = "Loop end"
    public static let laterBySecond = "Later by 1 second"
    public static let earlierBySecond = "Earlier by 1 second"
    public static let loopNotSaved = "The loop could not be saved."

    /// The default name of an unlabeled loop, from its offset into the trim as `m:ss`.
    static func loopName(_ time: String) -> String { "Loop \(time)" }

    /// `Repeating B part`, the badge on the player bar that opens the recording screen.
    public static func repeating(_ name: String) -> String { "Repeating \(name)" }

    /// `Repeat B part`, the play button with a loop selected, and the bar's control that stops
    /// the loop repeating.
    public static func repeatLoop(_ name: String) -> String { "Repeat \(name)" }

    /// `B part selected`, announced when a tap, Previous, or Next lands on a loop.
    public static func loopSelected(_ name: String) -> String { "\(name) selected" }

    /// `The playhead is in B part.`, why New loop is off inside a loop.
    public static func insideLoop(_ name: String) -> String { "The playhead is in \(name)." }

    /// `Speed 75%`, a mode's name with its value once that value is off its default.
    public static func segment(_ label: String, value: String?) -> String {
        value.map { "\(label) \($0)" } ?? label
    }

    /// `0:42 of 3:10`, the playhead's place on the trimmed timeline.
    static func position(_ ms: Int64, of lengthMs: Int64) -> String {
        "\(RecordingText.duration(of: ms)) of \(RecordingText.duration(of: lengthMs))"
    }

    /// `B part start, 0:58.3`, a handle's place on the trimmed timeline to the tenth of a second.
    static func handle(_ name: String, edge: String, time: String) -> String {
        "\(name) \(edge), \(time)"
    }
}
