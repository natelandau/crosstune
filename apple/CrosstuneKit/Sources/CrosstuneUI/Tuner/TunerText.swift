import CrosstuneAudio
import CrosstuneStore
import Foundation

/// The Tuner screen's words, the same as the web's `tunerCopy.ts` where they mean the same.
public enum TunerText {
    /// The hint under the cents when a note sits low or high.
    public static let flat = "Flat"
    public static let sharp = "Sharp"
    public static let listening = "Play a note"
    public static let micDeniedTitle = "Crosstune can't hear you"
    public static let micDeniedBody = "Turn on the microphone for Crosstune in Settings."
    public static let openSettings = "Open Settings"
    public static let micUnavailable = "No microphone found."

    /// The hint for a note `cents` off, or nil when it is in tune.
    public static func hintLabel(cents: Double) -> String? {
        tuneHint(cents: cents).map { $0 == .flat ? flat : sharp }
    }

    /// The reference pitch under the title, only when it is not the standard one, so a
    /// forgotten setting shows.
    public static func referenceLabel(_ hz: Int) -> String? {
        hz == UserSettings.defaultTunerA4Hz ? nil : SettingsModel.referencePitchLabel(hz)
    }

    /// The offset to a tenth of a cent, always signed, with a true minus sign.
    public static func centsLabel(_ cents: Double) -> String {
        let shown = tenths(cents)
        return "\(shown < 0 ? "\u{2212}" : "+")\(String(format: "%.1f", abs(shown)))¢"
    }

    /// A reading as a screen reader speaks it, such as A4, 3 cents flat.
    public static func spokenReading(_ note: Note) -> String {
        let name = "\(note.name.rawValue)\(note.octave)"
        if isInTune(cents: note.cents) { return "\(name), in tune" }
        let off = Int(abs(tenths(note.cents)).rounded())
        return "\(name), \(off) cents \(note.cents < 0 ? "flat" : "sharp")"
    }
}

/// What a screen reader is told as readings arrive: spoken again only when the note or whether
/// it is in tune changes, and at most once a second of input, so a held note is not read out on
/// every update.
struct TunerAnnouncer {
    /// The shortest gap, in ms of input, between two announcements.
    static let gapMs = 1000.0

    private var last: (key: String, atMs: Double)?

    /// The words to announce for `reading`, or nil to stay quiet.
    mutating func next(_ reading: Reading) -> String? {
        let note = reading.note
        let key = "\(note.name.rawValue)\(note.octave):\(isInTune(cents: note.cents))"
        // Input time restarts with each opening of the microphone.
        let due = last.map { reading.atMs < $0.atMs || reading.atMs - $0.atMs >= Self.gapMs } ?? true
        guard due, key != last?.key else { return nil }
        last = (key, reading.atMs)
        return TunerText.spokenReading(note)
    }
}
