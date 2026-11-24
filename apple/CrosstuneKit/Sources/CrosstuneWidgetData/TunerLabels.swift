/// The tuner's words and symbol, which the app's tuner screen and the Tuner widget both show.
/// They live here, outside the app's UI module, so the widget extension can read them.
public enum TunerLabels {
    public static let title = "Tuner"
    public static let systemImage = "gauge.with.needle"
    /// The prompt shown while no note is heard.
    public static let listening = "Play a note"
}
