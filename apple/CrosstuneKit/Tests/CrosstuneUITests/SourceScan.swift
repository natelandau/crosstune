import Foundation

/// Reads `CrosstuneUI`'s own source, for the tests that check a convention the compiler cannot.
enum SourceScan {
    static let sources = URL(filePath: #filePath)
        .deletingLastPathComponent()  // CrosstuneUITests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // CrosstuneKit
        .appending(path: "Sources/CrosstuneUI", directoryHint: .isDirectory)

    /// Every Swift file under `Sources/CrosstuneUI`.
    static func files() -> [URL] {
        FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil)?
            .compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" } ?? []
    }

    /// The file's path under `Sources/CrosstuneUI`.
    static func relative(_ file: URL) -> String {
        String(file.path.dropFirst(sources.path.count + 1))
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
}
