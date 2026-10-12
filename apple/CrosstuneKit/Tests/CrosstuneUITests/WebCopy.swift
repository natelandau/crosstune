import Foundation

/// The web's string constants by name, read from one of its copy files, `path` relative to the
/// repository root. Only plain quoted strings are read; template literals and functions are not.
func webCopy(_ path: String) throws -> [String: String] {
    let file = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: path)
    let text = try String(contentsOf: file, encoding: .utf8)
    let pattern = try NSRegularExpression(
        pattern: #"export const (\w+) =\s*(['"])(.*?)\2\n"#, options: [.dotMatchesLineSeparators])
    var found: [String: String] = [:]
    for match in pattern.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
        if let name = Range(match.range(at: 1), in: text), let value = Range(match.range(at: 3), in: text) {
            found[String(text[name])] = String(text[value])
        }
    }
    return found
}
