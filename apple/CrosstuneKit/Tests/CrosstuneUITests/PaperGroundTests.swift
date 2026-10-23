import Foundation
import Testing

@testable import CrosstuneUI

@Suite struct PaperGroundTests {
    /// A row's own background (the iPad's open Settings page draws `field`) must win over the
    /// card's. Rebuilding the form's sections drops a row's own list modifiers, so `PaperForm`
    /// keeps its sections as written.
    @Test func paperFormKeepsItsSectionsAsWritten() throws {
        let code = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.sources.appending(path: "Style/PaperGround.swift")))
        #expect(!code.contains("ForEach(sections:"))
        #expect(!code.contains("Group(sections:"))
        #expect(code.contains("Group { content }"))
    }
}
