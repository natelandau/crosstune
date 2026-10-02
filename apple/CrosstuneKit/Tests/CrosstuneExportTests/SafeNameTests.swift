import Testing

@testable import CrosstuneExport

@Suite struct SafeNameTests {
    @Test(arguments: [
        ("Jam: Ray/Sue", "Jam Ray Sue"),
        ("  spaced   out  ", "spaced out"),
        ("ends with dots...", "ends with dots"),
        ("???", "Untitled"),
        ("...", "Untitled"),
        ("Café", "Café"),
        ("Con", "_Con"),
        ("nul.Brio", "_nul.Brio"),
        ("COM1", "_COM1"),
        ("Console", "Console"),
        ("COM0", "COM0"),
        ("a\u{07}b\u{85}c\u{7F}d", "a b c d"),
        ("tab\tand\u{3000}ideographic\u{FEFF}space", "tab and ideographic space"),
    ])
    func replacesForbiddenCharactersAndTrims(raw: String, safe: String) {
        #expect(safeName(raw) == safe)
    }

    @Test func normalizesToNFC() {
        let decomposed = "Ri\u{301}l Mho\u{301}r"
        #expect(Array(safeName(decomposed).unicodeScalars) == Array("R\u{ED}l Mh\u{F3}r".unicodeScalars))
    }

    @Test func cutsTo100GraphemesWithoutSplittingOne() {
        let name = safeName(String(repeating: "👍🏽", count: 150))
        #expect(name.count == 100)
        #expect(name == String(repeating: "👍🏽", count: 100))
    }

    @Test func suffixesCaseInsensitiveCollisionsBeforeTheExtension() {
        var names = NameAllocator(reserving: ["Unfiled"])
        #expect(names.take("unfiled") == "unfiled (2)")
        #expect(names.take("Take", ext: "m4a") == "Take.m4a")
        #expect(names.take("take", ext: "m4a") == "take (2).m4a")
    }

    @Test func doesNotCollideAcrossExtensionsAndCountsUpward() {
        var names = NameAllocator()
        #expect(names.take("take", ext: "m4a") == "take.m4a")
        #expect(names.take("take", ext: "aac") == "take.aac")
        #expect(names.take("take", ext: "m4a") == "take (2).m4a")
        #expect(names.take("take", ext: "m4a") == "take (3).m4a")
    }
}
