/// The first letters of a name's first and last words, uppercased; one word gives one letter, and
/// a name with no words gives nil. A letter is a word's first code point, as the web reads it.
func initials(from name: String?) -> String? {
    let words = (name ?? "").split(whereSeparator: \.isWhitespace)
    guard let first = words.first else { return nil }
    let ends = words.count > 1 ? [first, words[words.count - 1]] : [first]
    return ends.compactMap { $0.unicodeScalars.first.map(String.init) }.joined().uppercased()
}
