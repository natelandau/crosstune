import Foundation

private let maxGraphemes = 100
private let fallback = "Untitled"

/// Path separators and Windows-reserved characters, which become a space along with control
/// characters.
private let forbidden: Set<Unicode.Scalar> = ["/", "\\", ":", "*", "?", "\"", "<", ">", "|"]

private func isForbidden(_ scalar: Unicode.Scalar) -> Bool {
    forbidden.contains(scalar) || scalar.value <= 0x1F || (0x7F...0x9F).contains(scalar.value)
}

/// Windows refuses these device names as a file or folder, whatever follows a first dot.
private let reserved = Set(["CON", "PRN", "AUX", "NUL"] + (1...9).flatMap { ["COM\($0)", "LPT\($0)"] })

private func isReserved(_ name: String) -> Bool {
    let stem = name.prefix { $0 != "." }
    return reserved.contains(stem.uppercased())
}

/// JavaScript's `\s`, so both clients collapse and trim the same characters. It differs from
/// Unicode's White_Space: it includes U+FEFF and leaves out U+0085.
private func isSpace(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
        true
    default:
        false
    }
}

private func trimEnds(_ scalars: some Collection<Unicode.Scalar>) -> String {
    let leading = scalars.drop(while: isSpace)
    var view = String.UnicodeScalarView(leading)
    while let last = view.last, isSpace(last) || last == "." { view.removeLast() }
    return String(view)
}

/// A file or folder name that is valid on macOS, Windows, and in a zip.
public func safeName(_ raw: String) -> String {
    var collapsed = String.UnicodeScalarView()
    for scalar in raw.precomposedStringWithCanonicalMapping.unicodeScalars {
        let next = isForbidden(scalar) ? " " : scalar
        if isSpace(next) {
            if collapsed.last != " " { collapsed.append(" ") }
        } else {
            collapsed.append(next)
        }
    }
    let cleaned = trimEnds(collapsed)
    let cut = trimEnds(String(cleaned.prefix(maxGraphemes)).unicodeScalars)
    let safe = cut.isEmpty ? fallback : cut
    return isReserved(safe) ? "_\(safe)" : safe
}

/// Hands out names that stay unique on case-insensitive filesystems.
public struct NameAllocator: Sendable {
    private var used: Set<String>

    /// `reserved` names are never handed out, as if taken before any other.
    public init(reserving reserved: [String] = []) {
        used = Set(reserved.map(Self.key))
    }

    public mutating func take(_ raw: String, ext: String? = nil) -> String {
        let base = safeName(raw)
        let suffix = ext.flatMap { $0.isEmpty ? nil : ".\($0)" } ?? ""
        var candidate = base + suffix
        var n = 2
        while used.contains(Self.key(candidate)) {
            candidate = "\(base) (\(n))\(suffix)"
            n += 1
        }
        used.insert(Self.key(candidate))
        return candidate
    }

    private static func key(_ name: String) -> String {
        name.lowercased(with: Locale(identifier: "en"))
    }
}
