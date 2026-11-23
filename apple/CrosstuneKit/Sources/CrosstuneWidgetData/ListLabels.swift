/// List words that the app's screens and the List widget both show. They live here, outside the
/// app's UI module, so the widget extension can read them.
public enum ListLabels {
    /// The name of the app's lists screen.
    public static let title = "Lists"
    public static let shuffle = "Shuffle"

    /// "1 tune" or "3 tunes": the one wording for a number of tunes.
    public static func tunes(_ count: Int) -> String {
        count == 1 ? "1 tune" : "\(count) tunes"
    }
}
