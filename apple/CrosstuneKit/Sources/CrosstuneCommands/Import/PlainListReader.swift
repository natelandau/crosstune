import CrosstuneVocabulary

/// One title read from a list, with the trimmed line it came from.
public struct PlainCandidate: Equatable, Sendable {
    public let title: String
    public let source: String

    public init(title: String, source: String) {
        self.title = title
        self.source = source
    }
}

/// The titles read from a list, and how many non-blank lines it held, headings included.
public struct PlainListRead: Equatable, Sendable {
    public let candidates: [PlainCandidate]
    public let lineCount: Int

    public init(candidates: [PlainCandidate], lineCount: Int) {
        self.candidates = candidates
        self.lineCount = lineCount
    }
}

/// Reads a pasted or opened plain-text list into candidate titles. The rules, and the order they
/// run in, are in `fixtures/import/README.md`; the web client's `readPlainList` follows the same
/// fixture. Text is handled by Unicode scalar throughout: `Character` treats `\r\n` as one
/// character and calls canonically equivalent spellings equal, and JavaScript does neither.
public enum PlainListReader {
    public static func read(_ text: String) -> PlainListRead {
        var candidates: [PlainCandidate] = []
        var lineCount = 0

        for raw in lines(of: text) {
            let source = trimmedText(raw)
            if source.isEmpty { continue }
            lineCount += 1
            if source.unicodeScalars.last == ":" { continue }

            var line = Array(source.unicodeScalars)
            while let rest = withoutLeadingMarker(line) {
                line = Array(trimmedText(string(rest)).unicodeScalars)
            }

            for part in parts(of: line) {
                let title = trimmedText(string(part))
                if !title.isEmpty { candidates.append(PlainCandidate(title: title, source: source)) }
            }
        }

        return PlainListRead(candidates: candidates, lineCount: lineCount)
    }

    /// The text split on `\r\n`, `\r`, and `\n`.
    private static func lines(of text: String) -> [String] {
        var lines: [String] = []
        var line = String.UnicodeScalarView()
        var afterCarriageReturn = false
        for scalar in text.unicodeScalars {
            defer { afterCarriageReturn = scalar == "\r" }
            if scalar == "\n", afterCarriageReturn { continue }
            if scalar == "\r" || scalar == "\n" {
                lines.append(String(line))
                line = String.UnicodeScalarView()
            } else {
                line.append(scalar)
            }
        }
        lines.append(String(line))
        return lines
    }

    /// The line after one leading marker and the whitespace that follows it, or nil when the line
    /// does not start with a marker. A marker counts only before whitespace or the end of the line,
    /// so "1952 Waltz" and "-Sally" keep their text.
    private static func withoutLeadingMarker(_ line: [Unicode.Scalar]) -> ArraySlice<Unicode.Scalar>? {
        guard let end = markerEnd(line) else { return nil }
        if end == line.endIndex { return line[end...] }
        guard isECMAScriptSpace(line[end]) else { return nil }
        let rest = line[end...].firstIndex { !isECMAScriptSpace($0) } ?? line.endIndex
        return line[rest...]
    }

    /// Where a leading bullet, number, or checkbox ends.
    private static func markerEnd(_ line: [Unicode.Scalar]) -> Int? {
        guard let first = line.first else { return nil }
        switch first {
        case "-", "*", "\u{2022}", "\u{25E6}", "\u{25AA}", "\u{2610}", "\u{2611}", "\u{2713}", "\u{2714}":
            return 1
        case "[":
            guard line.count >= 3, [" ", "x", "X"].contains(line[1]), line[2] == "]" else { return nil }
            return 3
        case "#":
            let digits = digitsEnd(line, from: 1)
            return digits > 1 ? digits : nil
        default:
            let digits = digitsEnd(line, from: 0)
            guard digits > 0, digits < line.count, line[digits] == "." || line[digits] == ")" else { return nil }
            return digits + 1
        }
    }

    /// The index past the ASCII digits that start at `start`. Only `0` to `9` count, as
    /// JavaScript's `\d` matches without the `u` flag.
    private static func digitsEnd(_ line: [Unicode.Scalar], from start: Int) -> Int {
        line[start...].firstIndex { !("0"..."9").contains($0) } ?? line.endIndex
    }

    /// The line split on `" / "`, scanning left to right so each separator uses its own scalars.
    private static func parts(of line: [Unicode.Scalar]) -> [ArraySlice<Unicode.Scalar>] {
        let separator: [Unicode.Scalar] = [" ", "/", " "]
        var parts: [ArraySlice<Unicode.Scalar>] = []
        var start = line.startIndex
        var index = line.startIndex
        while index + separator.count <= line.endIndex {
            if line[index..<index + separator.count].elementsEqual(separator) {
                parts.append(line[start..<index])
                index += separator.count
                start = index
            } else {
                index += 1
            }
        }
        parts.append(line[start...])
        return parts
    }

    private static func string<S: Sequence<Unicode.Scalar>>(_ scalars: S) -> String {
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars)
        return String(view)
    }
}
