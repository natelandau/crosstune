import Foundation
import Testing

/// Every sheet, dialog, and file picker in the UI covers the shell while it is up, so the record
/// dome hides and the menu commands stand down. A sheet's root view marks itself with
/// `.shellSheet()` or `.partHeightSheet()`; a dialog, alert, or file picker has no root view of
/// its own, so the view presenting it carries `.coversShell(_:)` on the line before.
@Suite struct PresentationClaimTests {
    /// Presentations nested inside a sheet that already covers the shell, by file, modifier, and
    /// text on the modifier's line or the next that names the one presentation.
    private static let nested: [(file: String, modifier: String, marker: String)] = [
        ("RecordSheet.swift", ".confirmationDialog(", "RecordSheetModel.discardTitle")
    ]

    private static func isNested(_ source: Source, line index: Int, modifier: String) -> Bool {
        let near = source.lines[index..<min(index + 2, source.lines.count)].joined(separator: "\n")
        return nested.contains { $0.file == source.name && $0.modifier == modifier && near.contains($0.marker) }
    }

    private static let sources = URL(filePath: #filePath)
        .deletingLastPathComponent()  // CrosstuneUITests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // CrosstuneKit
        .appending(path: "Sources/CrosstuneUI", directoryHint: .isDirectory)

    private struct Source {
        let name: String
        let lines: [String]
        var text: String { lines.joined(separator: "\n") }
    }

    private static func readSources() throws -> [Source] {
        let files =
            FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil)?
            .compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" } ?? []
        return try files.map {
            Source(
                name: $0.lastPathComponent,
                lines: try String(contentsOf: $0, encoding: .utf8).components(separatedBy: "\n"))
        }
    }

    @Test func everyDialogAlertAndFilePickerCoversTheShell() throws {
        var missing: [String] = []
        for source in try Self.readSources() {
            for (index, line) in source.lines.enumerated() {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard
                    let modifier = [".confirmationDialog(", ".alert(", ".fileImporter("].first(where: trimmed.hasPrefix)
                else { continue }
                if Self.isNested(source, line: index, modifier: modifier) { continue }
                let previous = source.lines[..<index].last { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
                if previous?.trimmingCharacters(in: .whitespaces).hasPrefix(".coversShell(") != true {
                    missing.append("\(source.name):\(index + 1) \(modifier)")
                }
            }
        }
        #expect(missing.isEmpty, "Add .coversShell(_:) on the line before: \(missing)")
    }

    @Test func everySheetsRootViewCoversTheShell() throws {
        let sources = try Self.readSources()
        let viewPattern = /struct (\w+)(?:<[^>]*>)?: View/
        var files: [String: Source] = [:]
        for source in sources {
            for match in source.text.matches(of: viewPattern) { files[String(match.1)] = source }
        }
        var missing: [String] = []
        for source in sources {
            for (index, line) in source.lines.enumerated() {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard let modifier = [".sheet(", ".fullScreenCover("].first(where: trimmed.hasPrefix) else { continue }
                if Self.isNested(source, line: index, modifier: modifier) { continue }
                // The first view the presentation builds within its next lines is its root.
                let body = source.lines[index..<min(index + 10, source.lines.count)].joined(separator: "\n")
                let root = body.matches(of: /\b([A-Z]\w*)\(/).map { String($0.1) }.first { files[$0] != nil }
                guard let root, let file = files[root] else {
                    missing.append("\(source.name):\(index + 1) has no root view")
                    continue
                }
                if !file.text.contains(".shellSheet()") && !file.text.contains(".partHeightSheet()") {
                    missing.append("\(source.name):\(index + 1) \(root)")
                }
            }
        }
        #expect(missing.isEmpty, "Mark the sheet's root with .shellSheet() or .partHeightSheet(): \(missing)")
    }
}
