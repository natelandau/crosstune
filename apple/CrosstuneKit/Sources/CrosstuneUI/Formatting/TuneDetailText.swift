/// The one line that describes a tune beside its title where its full row does not fit, such as
/// the share extension's tune list and the List widget's rows.
enum TuneDetailText {
    /// The tune type as a detail shows it: trimmed, or nil when blank.
    nonisolated static func type(_ tuneType: String?) -> String? {
        let type = tuneType?.trimmingCharacters(in: .whitespacesAndNewlines)
        return type?.isEmpty == false ? type : nil
    }

    /// The parts present, in the order given, joined by " · ", or nil when none is.
    nonisolated static func joined(_ parts: [String?]) -> String? {
        let present = parts.compactMap { $0 }
        return present.isEmpty ? nil : present.joined(separator: " · ")
    }
}
