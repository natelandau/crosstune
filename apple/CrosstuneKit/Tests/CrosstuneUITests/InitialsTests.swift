import Testing

@testable import CrosstuneUI

@Suite struct InitialsTests {
    @Test(arguments: [("Ada Lovelace", "AL"), ("Cher", "C"), ("  mary  ann  smith ", "MS")])
    func readsTheFirstAndLastWords(name: String, expected: String) {
        #expect(initials(from: name) == expected)
    }

    @Test(arguments: ["", "   ", nil] as [String?])
    func givesNilForNoName(name: String?) {
        #expect(initials(from: name) == nil)
    }

    /// By code point, as the web reads it, so a decomposed accent gives its base letter.
    @Test func takesTheFirstCodePoint() {
        #expect(initials(from: "e\u{301}mile zola") == "EZ")
        #expect(initials(from: "𝒜da") == "𝒜")
    }
}
