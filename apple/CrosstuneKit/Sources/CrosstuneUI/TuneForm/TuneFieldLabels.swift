import CrosstuneVocabulary

/// What each of a tune's fields is called, on the tune form and wherever else the field is set.
public enum TuneFieldLabels {
    /// The title field's placeholder. The sheet's own title already says New tune or Edit tune,
    /// so the field carries no visible label.
    public static let title = "Tune title"
    public static let status = "Status"
    public static let key = "Key"
    public static let tuning = "Tuning"
    public static let notes = "Notes"
    public static let notesPlaceholder = "How it goes, where it came from…"
    public static let details = "Details"
    public static let detailsFooter = "Separate alternate names with commas."

    public static let alternateTitles = "Also known as"
    public static let composer = "Composer"
    public static let genre = "Genre"
    public static let timeSignature = "Time signature"
    public static let tuneType = "Type"
    public static let partStructure = "Parts"
    public static let isCrooked = "Crooked"
    public static let crookedHelp = "An odd number of beats or bars in a part."
    public static let lyrics = "Lyrics"
    public static let lyricsPlaceholder = "The words, a verse at a time…"
    public static let learnedFrom = "Learned from"
    public static let learnedOn = "Learned on"

    /// Each part's mode row, in part order. The first covers the whole tune when it has one mode.
    public static let partModes = ["Mode", "B part mode", "C part mode", "D part mode"]
    public static let addPartMode = "Add mode for another part"
    public static let removePartMode = "Remove"

    /// An empty field's value, and the choice that leaves a field empty.
    public static let notSet = "Not set"
    /// The choice that reveals a text field for a value the suggestions lack.
    public static let other = "Other…"
    /// The capo picker's empty choice.
    public static let noCapo = "None"
    /// What pressing the empty learned-on row does, for a screen reader.
    public static let setsToday = "Sets today's date"
    /// The learned-on row's glyph that empties it.
    public static let clearDate = "Clear date"

    public static func tuning(_ instrument: String) -> String {
        "\(TuningText.instrumentLabel(instrument)) tuning"
    }

    public static func capo(_ instrument: String) -> String {
        "\(TuningText.instrumentLabel(instrument)) capo"
    }

    /// The text field Other reveals, "Other genre".
    public static func other(_ label: String) -> String {
        "Other \(label.lowercased())"
    }

    /// A part's mode row label, for as many parts as the API allows.
    public static func partMode(_ index: Int) -> String {
        partModes.indices.contains(index) ? partModes[index] : partModes[0]
    }
}
