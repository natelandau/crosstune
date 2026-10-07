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

/// A value's ``foldText(_:)`` key as UTF-16 code units, folded once so it can be compared with
/// many others without folding it again.
public struct FoldedText: Hashable, Sendable {
    public let units: [UInt16]

    public init(_ text: String) {
        units = Array(foldText(text).utf16)
    }

    /// Whether the value folds to nothing, as blank or combining marks alone do.
    public var isEmpty: Bool { units.isEmpty }
}

/// True when two values fold to the same key.
public func sameText(_ a: String, _ b: String) -> Bool {
    sameText(FoldedText(a), FoldedText(b))
}

/// ``sameText(_:_:)`` for values already folded.
public func sameText(_ a: FoldedText, _ b: FoldedText) -> Bool {
    a.units == b.units
}

/// True when the folded needle appears anywhere in the folded haystack.
public func containsText(_ haystack: String, _ needle: String) -> Bool {
    let key = FoldedText(needle)
    return key.isEmpty || containsText(FoldedText(haystack), key)
}

/// ``containsText(_:_:)`` for values already folded.
public func containsText(_ haystack: FoldedText, _ needle: FoldedText) -> Bool {
    // Searched by code unit, as JavaScript's `includes` searches, never by canonical equivalence.
    // A plain scan, since the generic `firstRange(of:)` costs far more on these short arrays.
    let (units, key) = (haystack.units, needle.units)
    guard let first = key.first else { return true }
    guard key.count <= units.count else { return false }
    for start in 0...(units.count - key.count) where units[start] == first {
        var offset = 1
        while offset < key.count, units[start + offset] == key[offset] { offset += 1 }
        if offset == key.count { return true }
    }
    return false
}
