/// How much of a recording's recorded date is known. A partial date is stored as UTC midnight
/// at the start of its year, month, or day.
public enum RecordingPrecision: String, CaseIterable, Codable, Sendable {
    case year, month, day, time
}
