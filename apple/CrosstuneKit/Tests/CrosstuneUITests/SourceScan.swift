import Foundation

/// Reads the source of `CrosstuneUI` and `CrosstuneDesign`, for the tests that check a convention
/// the compiler cannot. A file's path is relative to its module's folder, and the two modules
/// never share one, so `Components/PageSection.swift` names one file wherever it lives.
enum SourceScan {
    static let packageSources = URL(filePath: #filePath)
        .deletingLastPathComponent()  // CrosstuneUITests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // CrosstuneKit
        .appending(path: "Sources", directoryHint: .isDirectory)

    static let roots = ["CrosstuneUI", "CrosstuneDesign"].map {
        packageSources.appending(path: $0, directoryHint: .isDirectory)
    }

    /// Every Swift file in both modules.
    static func files() -> [URL] {
        roots.flatMap { root in
            FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?
                .compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" } ?? []
        }
    }

    /// The file at `path` under whichever module holds it, or under `CrosstuneUI` if neither
    /// does, so a read of a missing file fails.
    static func url(of path: String) -> URL {
        roots.map { $0.appending(path: path) }.first { FileManager.default.fileExists(atPath: $0.path) }
            ?? roots[0].appending(path: path)
    }

    /// The file's path under its module's folder.
    static func relative(_ file: URL) -> String {
        let root = roots.first { file.path.hasPrefix($0.path + "/") } ?? roots[0]
        return String(file.path.dropFirst(root.path.count + 1))
    }

    static func text(at url: URL) throws -> String {
        try String(contentsOf: url, encoding: .utf8)
    }

    /// `text` with every `//` comment removed, so a comment that names a modifier never counts
    /// as a use. Line numbers are kept.
    static func withoutComments(_ text: String) -> String {
        // Inside a multi-line string literal, which can span lines.
        var inBlock = false
        return text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { line in
                let chars = Array(line)
                var inString = false
                var index = 0
                while index < chars.count {
                    if chars[index...].starts(with: "\"\"\"") {
                        inBlock.toggle()
                        index += 3
                        continue
                    }
                    if inBlock {
                        index += 1
                        continue
                    }
                    switch chars[index] {
                    case "\\" where inString:
                        // Skips the escaped character, so an escaped quote never ends the string.
                        index += 2
                        continue
                    case "\"":
                        inString.toggle()
                    case "/" where !inString && index + 1 < chars.count && chars[index + 1] == "/":
                        return String(chars[..<index])
                    default:
                        break
                    }
                    index += 1
                }
                return String(line)
            }
            .joined(separator: "\n")
    }

    /// `text` without its `#Preview` blocks, which never ship. A block ends where its braces
    /// close, counting from its first brace, which may sit on a later line; braces inside a
    /// string or a comment never count.
    static func withoutPreviews(_ text: String) -> String {
        var depth = 0
        var opened = false
        var inPreview = false
        var inBlockComment = false
        var kept: [Substring] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if !inPreview, line.trimmingCharacters(in: .whitespaces).hasPrefix("#Preview") {
                inPreview = true
                depth = 0
                opened = false
            }
            guard inPreview else {
                kept.append(line)
                continue
            }
            let (opens, closes) = braces(in: line, inBlockComment: &inBlockComment)
            depth += opens - closes
            opened = opened || opens > 0
            if opened, depth <= 0 { inPreview = false }
        }
        return kept.joined(separator: "\n")
    }

    /// The `{` and `}` in `line` outside string literals and comments. `inBlockComment` carries
    /// a `/* */` comment from one line to the next.
    private static func braces(in line: Substring, inBlockComment: inout Bool) -> (opens: Int, closes: Int) {
        let chars = Array(line)
        var (opens, closes) = (0, 0)
        var inString = false
        var index = 0
        while index < chars.count {
            if inBlockComment {
                if chars[index] == "*", index + 1 < chars.count, chars[index + 1] == "/" {
                    inBlockComment = false
                    index += 1
                }
                index += 1
                continue
            }
            switch chars[index] {
            case "/" where !inString && index + 1 < chars.count && chars[index + 1] == "*":
                inBlockComment = true
                index += 1
            case "\\" where inString:
                index += 1
            case "\"":
                inString.toggle()
            case "/" where !inString && index + 1 < chars.count && chars[index + 1] == "/":
                return (opens, closes)
            case "{" where !inString:
                opens += 1
            case "}" where !inString:
                closes += 1
            default:
                break
            }
            index += 1
        }
        return (opens, closes)
    }

    /// The call that opens at `open`, a `(`, through its closing parenthesis and any trailing
    /// closures (`{ ... }`, or `label: { ... }` after the first), with strings skipped.
    static func call(in text: String, opening open: String.Index) -> Substring {
        let chars = Array(text[open...])
        var index = 0
        func skipBalanced(_ start: Character, _ end: Character) {
            var depth = 0
            var inString = false
            while index < chars.count {
                let char = chars[index]
                if inString {
                    if char == "\\" { index += 1 } else if char == "\"" { inString = false }
                } else if char == "\"" {
                    inString = true
                } else if char == start {
                    depth += 1
                } else if char == end {
                    depth -= 1
                    if depth == 0 {
                        index += 1
                        return
                    }
                }
                index += 1
            }
        }
        func skipSpace() { while index < chars.count, chars[index].isWhitespace { index += 1 } }
        skipBalanced("(", ")")
        var first = true
        while true {
            let mark = index
            skipSpace()
            if !first {
                // A labeled trailing closure: `label:` then its braces.
                var label = index
                while label < chars.count, chars[label].isLetter { label += 1 }
                guard label > index, label < chars.count, chars[label] == ":" else {
                    index = mark
                    break
                }
                index = label + 1
                skipSpace()
            }
            guard index < chars.count, chars[index] == "{" else {
                index = mark
                break
            }
            skipBalanced("{", "}")
            first = false
        }
        return text[open..<text.index(open, offsetBy: index)]
    }

    /// Which platforms a branch of an `#if` block compiles for, as far as the Mac goes: the Mac
    /// alone (or the Mac among others), never the Mac, or the Mac only sometimes.
    private enum Branch {
        case mac, other, both
    }

    /// A compilation condition's branch when it holds and when it does not.
    private struct Condition {
        let then: Branch
        let otherwise: Branch

        init(then: Branch, otherwise: Branch) {
            self.then = then
            self.otherwise = otherwise
        }

        init(_ condition: String) {
            var condition = condition.trimmingCharacters(in: .whitespaces)
            while condition.hasPrefix("("), condition.hasSuffix(")") {
                condition = String(condition.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
            }
            if condition.contains("&&") {
                // Holds only where every part holds; fails wherever any part fails.
                let parts = condition.components(separatedBy: "&&").map(Condition.init)
                self.init(then: Self.all(parts.map(\.then)), otherwise: Self.either(parts.map(\.otherwise)))
            } else if condition.contains("||") {
                // Holds wherever any part holds; fails only where every part fails.
                let parts = condition.components(separatedBy: "||").map(Condition.init)
                self.init(then: Self.either(parts.map(\.then)), otherwise: Self.all(parts.map(\.otherwise)))
            } else {
                switch condition {
                case "os(macOS)", "canImport(AppKit)", "!os(iOS)", "!canImport(UIKit)":
                    self.init(then: .mac, otherwise: .other)
                case "!os(macOS)", "os(iOS)", "os(visionOS)", "canImport(UIKit)", "!canImport(AppKit)":
                    self.init(then: .other, otherwise: .mac)
                default:
                    self.init(then: .both, otherwise: .both)
                }
            }
        }

        /// Where every part holds: never the Mac if any part rules it out, else the Mac alone if
        /// any part asks for it.
        private static func all(_ branches: [Branch]) -> Branch {
            if branches.contains(.other) { return .other }
            return branches.contains(.mac) ? .mac : .both
        }

        /// Where any part holds: one side only when every part agrees on it.
        private static func either(_ branches: [Branch]) -> Branch {
            if branches.allSatisfy({ $0 == .other }) { return .other }
            return branches.allSatisfy { $0 == .mac } ? .mac : .both
        }
    }

    /// Each line of `text` with the branches of the `#if` blocks it sits inside, outermost first.
    private static func branches(of text: String) -> [(line: String, stack: [Branch])] {
        // Each open block's current branch and the branch its `#else` would take.
        var open: [(current: Branch, otherwise: Branch)] = []
        var lines: [(String, [Branch])] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("#if ") {
                let condition = Condition(String(trimmed.dropFirst(4)))
                open.append((condition.then, condition.otherwise))
            } else if trimmed.hasPrefix("#elseif "), let last = open.popLast() {
                let next = Condition(String(trimmed.dropFirst(8)))
                if next.then == .both {
                    open.append((last.otherwise, last.otherwise))
                } else {
                    open.append((next.then, next.otherwise == last.otherwise ? last.otherwise : .both))
                }
            } else if trimmed == "#else", let last = open.popLast() {
                open.append((last.otherwise, last.otherwise))
            } else if trimmed.hasPrefix("#endif") {
                _ = open.popLast()
            }
            if !trimmed.hasPrefix("#") { lines.append((String(line), open.map(\.current))) }
        }
        return lines
    }

    /// The lines inside an `#if os(macOS)` branch (an `#else` of an iOS check counts), with
    /// nesting and `#else` followed. A file under `Mac/` is all Mac, so it comes back whole.
    static func macOSRegions(of text: String, in file: URL? = nil) -> String {
        if let file, relative(file).hasPrefix("Mac/") { return text }
        return branches(of: text)
            .filter { $0.stack.contains(.mac) && !$0.stack.contains(.other) }
            .map(\.line).joined(separator: "\n")
    }

    /// Every line the iOS build compiles: all but the branches only the Mac takes. `#if` lines
    /// are dropped, so line numbers do not carry over.
    static func iOSCompiled(_ text: String) -> String {
        branches(of: text)
            .filter { !($0.stack.contains(.mac) && !$0.stack.contains(.other)) }
            .map(\.line).joined(separator: "\n")
    }

    /// Every line the Mac build compiles: all but the branches only iOS takes.
    static func macCompiled(_ text: String) -> String {
        branches(of: text).filter { !$0.stack.contains(.other) }.map(\.line).joined(separator: "\n")
    }
}
