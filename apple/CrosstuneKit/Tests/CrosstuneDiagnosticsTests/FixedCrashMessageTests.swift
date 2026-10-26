import Foundation
import Testing

/// A crash or hang report keeps its message, so a trapping call's message is a fixed string. An
/// interpolated value could be what the person typed.
struct FixedCrashMessageTests {
    /// The one message allowed to interpolate, as the file under `apple/` and the literal's source
    /// text. It interpolates only an Info.plist key name, which is itself a literal.
    static let allowed: Set<String> = [
        #"Crosstune/AppConfiguration.swift: "Info.plist has no \(key). Set it in apple/Config/*.xcconfig.""#
    ]

    private static func swiftFiles(under root: URL) -> [URL] {
        guard
            let walker = FileManager.default.enumerator(
                at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        else { return [] }
        var files: [URL] = []
        for case let url as URL in walker {
            if url.lastPathComponent == ".build" {
                walker.skipDescendants()
            } else if url.pathExtension == "swift" {
                files.append(url)
            }
        }
        return files
    }

    /// The source text of each string literal in the call that opens at `open` that interpolates,
    /// raw strings (`#"\#(x)"#`) included.
    private static func interpolatedLiterals(_ text: [Character], openingAt open: Int) -> [String] {
        func hasHashes(_ count: Int, at index: Int) -> Bool {
            index + count <= text.count && text[index..<(index + count)].allSatisfy { $0 == "#" }
        }
        var found: [String] = []
        var depth = 0
        var i = open
        while i < text.count {
            var quote = i
            while quote < text.count, text[quote] == "#" { quote += 1 }
            if quote < text.count, text[quote] == "\"" {
                let hashes = quote - i
                var k = quote + 1
                var interpolates = false
                while k < text.count {
                    if text[k] == "\\", hasHashes(hashes, at: k + 1) {
                        let escaped = k + 1 + hashes
                        if escaped < text.count, text[escaped] == "(" { interpolates = true }
                        k = escaped + 1
                    } else if text[k] == "\"", hasHashes(hashes, at: k + 1) {
                        k += 1 + hashes
                        break
                    } else {
                        k += 1
                    }
                }
                if interpolates { found.append(String(text[i..<min(k, text.count)])) }
                i = k
                continue
            }
            if quote > i {
                i = quote
                continue
            }
            if text[i] == "(" {
                depth += 1
            } else if text[i] == ")" {
                depth -= 1
                if depth == 0 { break }
            }
            i += 1
        }
        return found
    }

    @Test func findsInterpolationInPlainAndRawStrings() {
        #expect(Self.interpolatedLiterals(Array(#"fatalError("a \"b\" \(x)")"#), openingAt: 10) == [#""a \"b\" \(x)""#])
        let source = Array(##"fatalError(#"bad \#(x)"#)"##)
        #expect(Self.interpolatedLiterals(source, openingAt: 10) == [##"#"bad \#(x)"#"##])
        #expect(Self.interpolatedLiterals(Array(##"fatalError(#"fixed \(x)"#)"##), openingAt: 10).isEmpty)
    }

    @Test func crashMessagesInterpolateNothing() throws {
        let apple = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
        let call = try Regex(#"\b(?:fatalError|preconditionFailure|precondition|assertionFailure|assert)\("#)
        var violations: [String] = []
        var allowedSeen: Set<String> = []
        for root in ["CrosstuneKit/Sources", "Crosstune"] {
            for url in Self.swiftFiles(under: apple.appending(path: root)) {
                let relative = String(url.path.dropFirst(apple.path.count + 1))
                let source = try String(contentsOf: url, encoding: .utf8)
                let text = Array(source)
                for match in source.matches(of: call) {
                    let offset = source.distance(from: source.startIndex, to: match.range.upperBound) - 1
                    let lineStart =
                        source[..<match.range.lowerBound].lastIndex(of: "\n")
                        .map { source.index(after: $0) } ?? source.startIndex
                    if source[lineStart..<match.range.lowerBound].contains("//") { continue }
                    for literal in Self.interpolatedLiterals(text, openingAt: offset) {
                        let entry = "\(relative): \(literal)"
                        if Self.allowed.contains(entry) {
                            allowedSeen.insert(entry)
                            continue
                        }
                        let line = source[..<match.range.lowerBound].filter { $0 == "\n" }.count + 1
                        violations.append("\(relative):\(line)")
                    }
                }
            }
        }
        #expect(violations.isEmpty, "crash messages must not interpolate values: \(violations)")
        #expect(allowedSeen == Self.allowed, "an allowed message no longer exists")
    }
}
