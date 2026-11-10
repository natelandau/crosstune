import Foundation
import Testing

/// A sheet's confirm button disables only for invalid input: while it saves it shows the working
/// state, and with nothing changed it stays enabled and closes the sheet.
struct ConfirmRuleTests {
    /// The iOS-compiled code of every `ConfirmToolbarItem { ... }` in `path`, with all whitespace
    /// removed, so line breaks and indentation never decide a match.
    static func confirmBlocks(in path: String, sourceLocation: SourceLocation = #_sourceLocation) throws -> [String] {
        let code = try ControlLibraryTests.code(of: SourceScan.url(of: path))
        var blocks: [String] = []
        var searchStart = code.startIndex
        while let match = code[searchStart...].firstRange(of: "ConfirmToolbarItem") {
            guard let open = code[match.upperBound...].firstIndex(of: "{") else { break }
            var depth = 0
            var index = open
            while index < code.endIndex {
                if code[index] == "{" { depth += 1 }
                if code[index] == "}" {
                    depth -= 1
                    if depth == 0 { break }
                }
                index = code.index(after: index)
            }
            blocks.append(String(code[open..<index].filter { !$0.isWhitespace }))
            searchStart = index < code.endIndex ? code.index(after: index) : code.endIndex
        }
        return blocks
    }

    /// Every `.disabled(...)` argument in a whitespace-free block.
    static func disabledConditions(in block: String) -> [String] {
        block.matches(of: /\.disabled\(((?:[^()]|\([^()]*\))*)\)/).map { String($0.1) }
    }

    static let savingSheets = [
        "Lists/ListNameSheet.swift", "Links/LinkSheet.swift", "Lyrics/LyricsReader.swift",
        "Recordings/RenameLocationSheet.swift", "Selection/BulkEditSheet.swift",
    ]

    @Test(arguments: savingSheets)
    func aSavingConfirmNeverDisablesWhileItSaves(path: String) throws {
        let blocks = try Self.confirmBlocks(in: path)
        #expect(blocks.isEmpty == false, "\(path) has no confirm button")
        for block in blocks {
            for condition in Self.disabledConditions(in: block) {
                #expect(condition.contains("isSaving") == false, "\(path) disables its confirm while saving")
                #expect(condition.contains("isPending") == false, "\(path) disables its confirm while saving")
            }
        }
    }

    @Test func theTuneFormDisablesSaveOnlyWithoutATitle() throws {
        let blocks = try Self.confirmBlocks(in: "TuneForm/TuneFormSheet.swift")
        #expect(blocks.count == 1)
        #expect(blocks.flatMap(Self.disabledConditions) == ["!model.hasTitle"])
    }

    @Test func bulkEditSaveStaysEnabledWithNothingEdited() throws {
        let blocks = try Self.confirmBlocks(in: "Selection/BulkEditSheet.swift")
        #expect(blocks.isEmpty == false)
        for block in blocks {
            #expect(Self.disabledConditions(in: block).contains { $0.contains("isEdited") } == false)
        }
    }

    @Test func importDisablesContinueAndAddOnlyForInvalidInput() throws {
        let blocks = try Self.confirmBlocks(in: "Import/ImportSheet.swift")
        #expect(blocks.count == 1)
        #expect(blocks.flatMap(Self.disabledConditions) == ["!model.hasTextToReview", "!model.hasTunesToAdd"])
    }

    @Test func findsADisabledConditionAcrossLines() {
        let block = "{Button(\"\"){}\n    .disabled(\n  model.isSaving || isBlank\n)}".filter { !$0.isWhitespace }
        #expect(Self.disabledConditions(in: block) == ["model.isSaving||isBlank"])
    }
}
