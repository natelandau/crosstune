import Foundation
import Testing

/// Every sheet, dialog, and file or photo picker in the UI covers the shell while it is up, so the record
/// slot and the menu commands stand down. A sheet's root view marks itself with
/// `.shellSheet()` or `.partHeightSheet()`; a dialog, alert, file picker, or share sheet has no
/// root view of its own, so the view presenting it carries `.coversShell(_:)` on the line before.
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
                    let modifier = [
                        ".confirmationDialog(", ".alert(", ".fileImporter(", ".fileExporter(", ".shareSheet(",
                        ".photosPicker(",
                    ]
                    .first(where: trimmed.hasPrefix)
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

    /// The scan pickers and viewer are presentations the checks above must see, so a rename
    /// that hid them from the scan fails here rather than passing quietly.
    @Test func theScanPickersAndViewerAreChecked() throws {
        let sources = try Self.readSources()
        let menu = try #require(sources.first { $0.name == "ScanAddMenu.swift" })
        let presentations = menu.lines.map { $0.trimmingCharacters(in: .whitespaces) }
        #expect(presentations.contains { $0.hasPrefix(".fileImporter(") })
        #expect(presentations.contains { $0.hasPrefix(".photosPicker(") })
        #expect(presentations.contains { $0.hasPrefix(".fullScreenCover(") })
        let viewer = try #require(sources.first { $0.name == "ScanViewer.swift" })
        #expect(viewer.text.contains("struct ScanViewer: View"))
        #expect(viewer.text.contains(".shellSheet()"))
        // A broken scan's Delete confirms first, since a captured scan is the only copy.
        #expect(viewer.lines.contains { $0.trimmingCharacters(in: .whitespaces).hasPrefix(".confirmationDialog(") })
        let scanner = try #require(sources.first { $0.name == "DocumentScanner.swift" })
        #expect(scanner.text.contains(".shellSheet()"))
    }
}
