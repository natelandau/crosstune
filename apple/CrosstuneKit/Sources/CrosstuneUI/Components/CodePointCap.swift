extension String {
    /// This text cut to `limit` code points, the unit the server counts, without splitting a
    /// character made of several.
    func cappedCodePoints(_ limit: Int) -> String {
        guard unicodeScalars.count > limit else { return self }
        var kept = ""
        var scalars = 0
        for character in self {
            scalars += character.unicodeScalars.count
            if scalars > limit { break }
            kept.append(character)
        }
        return kept
    }
}
