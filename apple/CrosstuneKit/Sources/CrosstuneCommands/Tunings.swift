import CrosstuneStore
import CrosstuneVocabulary

/// The tuning and capo an instrument's entry in a tune's tunings holds, or nils when it has
/// none. A pulled row can come from a server newer than this build, so an entry or field of a
/// shape this build does not know reads as unset rather than failing.
public func tuningEntry(_ tunings: JSONObject, instrument: String) -> (tuning: String?, capo: Int64?) {
    guard case .object(let entry) = tunings[instrument] ?? .null else { return (nil, nil) }
    var tuning: String?
    if case .string(let value) = entry["tuning"] ?? .null { tuning = value }
    var capo: Int64?
    if case .integer(let value) = entry["capo"] ?? .null { capo = value }
    return (tuning, capo)
}

/// The tunings map with one instrument's entry replaced by `tuning` and `capo`, every other key
/// kept, and the entry dropped once both are nil. Written the way the API stores it: no null
/// fields, and no capo on an instrument that takes none, which the API refuses whatever its
/// value.
public func setTuning(_ tunings: JSONObject, instrument: String, tuning: String?, capo: Int64?) -> JSONObject {
    var entry: JSONObject = [:]
    if let tuning { entry["tuning"] = .string(tuning) }
    if let capo, Vocabulary.capoInstruments.contains(instrument) { entry["capo"] = .integer(capo) }
    var next = tunings
    if entry.isEmpty { next.removeValue(forKey: instrument) } else { next[instrument] = .object(entry) }
    return next
}
