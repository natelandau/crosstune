import Foundation
import Testing

/// Every text field the iOS build compiles names its kind with `.textEntry(_:)`, which sets its
/// keyboard and gives a keyboard with no Return a Done, and every system search goes through
/// `listSearch`, which types it as a search. The scan reads the source, since a missing kind
/// shows only on a device's keyboard.
struct TextEntryKindTests {
    /// The line of each input in `code` whose modifier chain names no kind.
    static func untypedInputs(in code: String) -> [String] {
        let chars = Array(code)
        var untyped: [String] = []
        for index in chars.indices {
            // A member call or a longer name, such as `MultilineTextField(`, is not an input.
            if index > 0, chars[index - 1] == "." || SourceScan.isWordCharacter(chars[index - 1]) { continue }
            guard
                let input = ContentMaskTests.inputs.first(where: { chars[index...].starts(with: $0 + "(") })
            else { continue }
            let close = SourceScan.matching(chars, from: index + input.count)
            if !SourceScan.modifiers(in: chars, after: close).contains("textEntry") {
                let lineEnd = chars[index...].firstIndex(of: "\n") ?? chars.endIndex
                untyped.append(String(chars[index..<lineEnd]))
            }
        }
        return untyped
    }

    /// The iOS build's code in `file`, without comments.
    private static func iOSCode(_ file: URL) throws -> String {
        SourceScan.iOSCompiled(SourceScan.withoutComments(try SourceScan.text(at: file)))
    }

    @Test func everyTextFieldNamesItsKind() throws {
        var untyped: [String] = []
        for file in SourceScan.files() where !SourceScan.relative(file).hasPrefix("Mac/") {
            for input in Self.untypedInputs(in: try Self.iOSCode(file)) {
                untyped.append("\(SourceScan.relative(file)): \(input)")
            }
        }
        #expect(untyped.isEmpty, "Add .textEntry(_:) to the field's modifier chain: \(untyped.sorted())")
    }

    @Test func everySystemSearchGoesThroughListSearch() throws {
        let direct = try SourceScan.files()
            .filter { try Self.iOSCode($0).contains(".searchable(") }
            .map(SourceScan.relative)
        #expect(direct.isEmpty, "Use .listSearch(text:prompt:) in place of .searchable: \(direct)")
    }

    @Test func aKindAnywhereInTheChainCountsAndOnlyInputsAreScanned() {
        let code = """
            TextField(label, text: $name)
                .contentMask()
                .textEntry(.name)
            TextEditor(text: $notes).contentMask()
            MultilineTextField(title, text: $text, prompt: prompt)
            SecureField(label, text: $code).textEntry(.verbatim)
            """
        #expect(Self.untypedInputs(in: code) == ["TextEditor(text: $notes).contentMask()"])
    }

    @Test func aMacOnlyFieldIsNotScanned() {
        let code = """
            #if os(macOS)
                TextField(label, text: $name)
            #else
                TextField(label, text: $name)
                    .textEntry(.name)
            #endif
            """
        #expect(Self.untypedInputs(in: SourceScan.iOSCompiled(code)).isEmpty)
    }
}
