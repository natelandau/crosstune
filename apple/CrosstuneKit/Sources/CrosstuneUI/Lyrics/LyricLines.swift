import Foundation

/// Splits a lyrics body into verses of lines, and takes its opening lines for a row that stands
/// in for the whole body.
public enum LyricLines {
    /// A blank line, however many of them a paste carries, is one verse break; every other line
    /// is kept as written apart from the whitespace at either end, since the reading view renders
    /// a line as ordinary text, which collapses an indent anyway.
    public static func lines(_ text: String?) -> [[String]] {
        guard let text else { return [] }
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let rawLines = normalized.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        var verses: [[String]] = []
        var verse: [String] = []
        for line in rawLines {
            if line.isEmpty {
                if !verse.isEmpty { verses.append(verse) }
                verse = []
                continue
            }
            verse.append(line)
        }
        if !verse.isEmpty { verses.append(verse) }
        return verses
    }

    /// The opening lines, for a row that stands in for the whole body.
    public static func opening(_ text: String?, count: Int) -> [String] {
        Array(lines(text).flatMap { $0 }.prefix(Swift.max(0, count)))
    }
}
