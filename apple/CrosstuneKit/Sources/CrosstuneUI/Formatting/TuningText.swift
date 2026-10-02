import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary

/// How a tune's tunings read on screen, per instrument.
public enum TuningText {
    /// As ``tuningDisplay(_:instrument:withInstrument:)``, but nil for the instrument's standard tuning
    /// with no capo, which a row leaves unsaid.
    public static func summary(_ tunings: JSONObject, instrument: String, withInstrument: Bool = false) -> String? {
        let entry = tuningEntry(tunings, instrument: instrument)
        if entry.capo == nil, let tuning = entry.tuning, tuning == Vocabulary.standardTunings[instrument] {
            return nil
        }
        return tuningDisplay(tunings, instrument: instrument, withInstrument: withInstrument)
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
