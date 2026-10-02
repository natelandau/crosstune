import Foundation

private let bom = "\u{FEFF}"

private func encodeField(_ field: String) -> String {
    // Literal, scalar-level matching: a quote or line break that a combining mark follows is
    // still one Swift Character, which a Character-level search would miss.
    let value = field.replacingOccurrences(of: "\r\n", with: "\n", options: .literal)
        .replacingOccurrences(of: "\r", with: "\n", options: .literal)
    let needsQuotes = value.unicodeScalars.contains { $0 == "\"" || $0 == "," || $0 == "\r" || $0 == "\n" }
    guard needsQuotes else { return value }
    return "\"\(value.replacingOccurrences(of: "\"", with: "\"\"", options: .literal))\""
}

/// A UTF-8 CSV document: BOM, CRLF-terminated records, RFC 4180 quoting.
public func csvDocument(_ rows: [[String]]) -> String {
    bom + rows.map { $0.map(encodeField).joined(separator: ",") + "\r\n" }.joined()
}
