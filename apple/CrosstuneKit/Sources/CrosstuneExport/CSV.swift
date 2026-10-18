import Foundation

private let bom = "\u{FEFF}"

/// Whether every scalar is an ASCII digit, with at least one.
private func digits(_ scalars: Substring.UnicodeScalarView) -> Bool {
    !scalars.isEmpty && scalars.allSatisfy { ("0"..."9").contains($0) }
}

/// An optional sign, then digits with at most one decimal point and at least one digit.
private func isNumber(_ field: String) -> Bool {
    var text = Substring(field)
    if text.unicodeScalars.first == "+" || text.unicodeScalars.first == "-" {
        text = Substring(text.unicodeScalars.dropFirst())
    }
    let parts = text.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
    switch parts.count {
    case 1: return digits(parts[0].unicodeScalars)
    case 2:
        let (whole, fraction) = (parts[0].unicodeScalars, parts[1].unicodeScalars)
        return (digits(whole) && (fraction.isEmpty || digits(fraction))) || (whole.isEmpty && digits(fraction))
    default: return false
    }
}

/// The cell as written, or with a leading quote when a spreadsheet would run it as a formula.
private func guarded(_ field: String) -> String {
    guard let first = field.unicodeScalars.first, "=+-@\t\r".unicodeScalars.contains(first), !isNumber(field)
    else { return field }
    return "'" + field
}

private func encodeField(_ field: String) -> String {
    // Literal, scalar-level matching: a quote or line break that a combining mark follows is
    // still one Swift Character, which a Character-level search would miss.
    let value = guarded(field).replacingOccurrences(of: "\r\n", with: "\n", options: .literal)
        .replacingOccurrences(of: "\r", with: "\n", options: .literal)
    let needsQuotes = value.unicodeScalars.contains { $0 == "\"" || $0 == "," || $0 == "\r" || $0 == "\n" }
    guard needsQuotes else { return value }
    return "\"\(value.replacingOccurrences(of: "\"", with: "\"\"", options: .literal))\""
}

/// A UTF-8 CSV document: BOM, CRLF-terminated records, RFC 4180 quoting. A cell a spreadsheet
/// would run as a formula starts with a quote; a number never does.
public func csvDocument(_ rows: [[String]]) -> String {
    bom + rows.map { $0.map(encodeField).joined(separator: ",") + "\r\n" }.joined()
}
