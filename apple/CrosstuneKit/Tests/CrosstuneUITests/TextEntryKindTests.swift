import Foundation
import Testing

/// Every text field names its kind with `.textEntry(_:)`, which sets its keyboard on iPhone and
/// iPad and gives a keyboard with no Return a Done. The scan reads the source, since a missing
/// kind shows only on a device's keyboard. The Mac's own folders are skipped, since the kind
/// changes nothing there.
struct TextEntryKindTests {
    static let inputs = ["TextField(", "TextEditor(", "SecureField("]

    /// The line of each input in `text` whose modifier chain names no kind.
    static func untypedLines(in text: String) -> [Int] {
        let chars = Array(SourceScan.withoutComments(text))
        var lines: [Int] = []
        for index in chars.indices {
            guard let input = inputs.first(where: { chars[index...].starts(with: $0) }) else { continue }
            // A member call or a longer name, such as `MultilineTextField(`, is not an input.
            if index > 0, chars[index - 1] == "." || chars[index - 1].isLetter || chars[index - 1] == "_" {
                continue
            }
            let close = ContentMaskTests.matching(chars, from: index + input.count - 1)
            if !ContentMaskTests.modifiers(in: chars, after: close).contains("textEntry") {
                lines.append(chars[..<index].count { $0 == "\n" } + 1)
            }
        }
        return lines
    }

    @Test func everyTextFieldNamesItsKind() throws {
        var untyped: [String] = []
        for file in SourceScan.files() where !SourceScan.relative(file).hasPrefix("Mac/") {
            let relative = SourceScan.relative(file)
            for line in Self.untypedLines(in: try SourceScan.text(at: file)) {
                untyped.append("\(relative):\(line)")
            }
        }
        #expect(untyped.isEmpty, "Add .textEntry(_:) to the field's modifier chain: \(untyped.sorted())")
    }

    @Test func aKindAnywhereInTheChainCountsAndOnlyInputsAreScanned() {
        let text = """
            TextField(label, text: $name)
                .contentMask()
                .textEntry(.name)
            TextEditor(text: $notes).contentMask()
            MultilineTextField(title, text: $text, prompt: prompt)
            SecureField(label, text: $code).textEntry(.verbatim)
            """
        #expect(Self.untypedLines(in: text) == [4])
    }
}
