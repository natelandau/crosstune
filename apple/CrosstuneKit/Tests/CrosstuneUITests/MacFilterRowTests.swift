#if os(macOS)
    import Testing

    @testable import CrosstuneUI

    @Suite struct MacFilterRowTests {
        @Test func keyLabelNamesTheChosenKeyOrAny() {
            #expect(MacFilterRow.keyLabel(nil) == "Key: Any")
            #expect(MacFilterRow.keyLabel("D") == "Key: D")
        }

        @Test func keyLabelSpellsOutNoKey() {
            #expect(MacFilterRow.keyLabel(CatalogFilters.noKey) == "Key: \(KeyChooser.unknownKey)")
        }

        @Test func pickingTheChosenKeyAgainClearsIt() {
            #expect(KeyFilterPopover.choice(picking: "D", selected: nil) == "D")
            #expect(KeyFilterPopover.choice(picking: "G", selected: "D") == "G")
            #expect(KeyFilterPopover.choice(picking: "D", selected: "D") == nil)
        }

        @Test func typeLabelNamesTheChosenTypeOrAny() {
            #expect(MacFilterRow.typeLabel("Reel") == "Type: Reel")
            #expect(MacFilterRow.typeLabel(nil) == "Type: Any")
        }
    }
#endif
