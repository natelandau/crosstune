import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary

/// How a tune's tunings read on screen, per instrument.
public enum TuningText {
    /// The instrument's display name, or its raw value for one this build does not know.
    public static func instrumentLabel(_ instrument: String) -> String {
        Vocabulary.instrumentLabels[instrument] ?? instrument
    }

    /// One instrument's tuning, capo, or both: "Open G (gDGBD), capo 2", "Capo 2". Nil when the
    /// tune holds neither. `withInstrument` prefixes the instrument's name, "Mandolin: GDAE".
    public static func display(_ tunings: JSONObject, instrument: String, withInstrument: Bool = false) -> String? {
        let entry = tuningEntry(tunings, instrument: instrument)
        let text: String
        switch (entry.tuning, entry.capo) {
        case (nil, nil): return nil
        case (let tuning?, nil): text = tuning
        case (nil, let capo?): text = "Capo \(capo)"
        case (let tuning?, let capo?): text = "\(tuning), capo \(capo)"
        }
        return withInstrument ? "\(instrumentLabel(instrument)): \(text)" : text
    }

    /// As ``display(_:instrument:withInstrument:)``, but nil for the instrument's standard tuning
    /// with no capo, which a row leaves unsaid.
    public static func summary(_ tunings: JSONObject, instrument: String, withInstrument: Bool = false) -> String? {
        let entry = tuningEntry(tunings, instrument: instrument)
        if entry.capo == nil, let tuning = entry.tuning, tuning == Vocabulary.standardTunings[instrument] {
            return nil
        }
        return display(tunings, instrument: instrument, withInstrument: withInstrument)
    }

    /// The tunings a tune row shows: one summary per instrument the musician plays, in the
    /// vocabulary's order, joined with middle dots. Nil when there is nothing to say.
    public static func row(_ tunings: JSONObject, instruments: Set<String>) -> String? {
        // A player of one instrument knows whose tuning it is; two instruments can share a name.
        let withInstrument = instruments.count > 1
        let parts = Vocabulary.instruments.filter(instruments.contains).compactMap {
            summary(tunings, instrument: $0, withInstrument: withInstrument)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
