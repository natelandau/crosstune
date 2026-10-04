import Foundation

// The one rule every client uses to decide that two pieces of text are the same, ignoring case,
// accents, and outer whitespace. It never reads the reader's locale, so every device and the web
// client fold a value to the same key; `fixtures/text/fold.json` pins it. Final sigma becomes
// plain sigma: JavaScript and Foundation disagree on where a word ends, and a word's stem must
// still be found inside a longer word. Ordering is a separate question: lists still sort with a
// locale-aware compare.

/// ECMAScript's whitespace and line terminators, the set `String.prototype.trim` removes.
private func isECMAScriptSpace(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0xFEFF, 0x2028, 0x2029: true
    default: scalar.properties.generalCategory == .spaceSeparator
    }
}

/// JavaScript's `trim()`, which keeps U+0085 and removes U+FEFF, unlike `.whitespacesAndNewlines`.
public func trimmedText(_ text: String) -> String {
    let scalars = text.unicodeScalars
    guard let first = scalars.firstIndex(where: { !isECMAScriptSpace($0) }),
        let last = scalars.lastIndex(where: { !isECMAScriptSpace($0) })
    else { return "" }
    return String(scalars[first...last])
}

/// The key two values share when they are the same: trimmed, decomposed, stripped of nonspacing
/// marks, then lowercased.
public func foldText(_ text: String) -> String {
    var bare = String.UnicodeScalarView()
    bare.append(
        contentsOf: trimmedText(text).decomposedStringWithCanonicalMapping.unicodeScalars.filter {
            $0.properties.generalCategory != .nonspacingMark
        })
    // NSString's lowercasing reads no locale, as JavaScript's toLowerCase does.
    return (String(bare) as NSString).lowercased.replacingOccurrences(of: "\u{3C2}", with: "\u{3C3}", options: .literal)
}

/// True when two values fold to the same key.
public func sameText(_ a: String, _ b: String) -> Bool {
    foldText(a).utf16.elementsEqual(foldText(b).utf16)
}

/// True when the folded needle appears anywhere in the folded haystack.
public func containsText(_ haystack: String, _ needle: String) -> Bool {
    let key = foldText(needle)
    // Searched by code unit, as JavaScript's `includes` searches, never by canonical equivalence.
    return key.isEmpty || foldText(haystack).utf16.firstRange(of: key.utf16) != nil
}
