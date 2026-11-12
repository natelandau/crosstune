import Foundation

/// The words the recording page shows: its tabs, and the rows of its Details tab and its
/// attributes column, which also title each row's editor.
public enum RecordingPageCopy {
    public static let details = "Details"
    public static let practice = "Practice"
    /// The Details and Practice control, for VoiceOver.
    public static let tabs = "Recording page"
    /// The attributes' accessible name, as a column or on the Details tab.
    public static let attributesLabel = "Recording details"

    public static let name = "Name"
    public static let tune = "Linked Tune"
    public static let players = "Players"
    public static let recorded = "Recorded"
    public static let location = "Location"
    public static let notes = "Notes"

    /// The groups, in order: the recording's own details, then its location, then its notes.
    public static let detailsGroup = details
    public static let locationGroup = location
    public static let notesGroup = notes

    /// What a row with no value reads.
    public static let notSet = TuneFieldLabels.notSet
}
