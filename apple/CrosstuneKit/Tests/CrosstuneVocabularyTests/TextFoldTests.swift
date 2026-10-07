import Foundation
import Testing

@testable import CrosstuneVocabulary

/// The cases the web client's `foldText` passes too, so both clients call the same values equal.
private let foldFixture = URL(filePath: #filePath)
    .deletingLastPathComponent()  // CrosstuneVocabularyTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // CrosstuneKit
    .deletingLastPathComponent()  // apple
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/text/fold.json")

private struct FoldCase: Decodable, CustomTestStringConvertible, Sendable {
    let input: String
    let key: String

    var testDescription: String { input.unicodeScalars.map { String($0.value, radix: 16) }.joined(separator: " ") }
}

private let foldCases: [FoldCase] =
    (try? JSONDecoder().decode([FoldCase].self, from: Data(contentsOf: foldFixture))) ?? []

@Suite struct TextFoldTests {
    @Test func findsTheSharedFixture() {
        #expect(foldCases.count >= 30)
    }

    @Test(arguments: foldCases)
    fileprivate func foldsTheSharedCase(_ fold: FoldCase) {
        // String equality is canonical equivalence; the code units keep NFC and NFD apart.
        #expect(Array(foldText(fold.input).utf16) == Array(fold.key.utf16))
    }

    @Test func matchesSpellingsThatDifferOnlyByCaseAccentsOrOuterWhitespace() {
        #expect(sameText("Irish", " \u{CD}RISH "))
        #expect(sameText("F\u{EA}te", "Fe\u{302}te"))
    }

    @Test func keepsDifferentLettersApart() {
        #expect(!sameText("Stra\u{DF}e", "Strasse"))
        #expect(!sameText("\u{131}", "i"))
    }

    @Test func findsAFoldedNeedleAnywhereInTheHaystack() {
        #expect(containsText("The \u{C9}t\u{E9} Waltz", "ete wal"))
    }

    @Test func trimsTheNeedleSoInnerSpacesStillCount() {
        #expect(containsText("Ete Waltz", "  ete  "))
        #expect(!containsText("Ete Waltz", "ete  waltz"))
    }

    @Test func findsAWordEndingInSigmaAtTheStartOfALongerWord() {
        #expect(containsText("Οδοσάκης", "ΟΔΟΣ"))
    }

    @Test func findsAnEmptyNeedleInAnything() {
        #expect(containsText("Reel", ""))
    }

    @Test(arguments: foldCases)
    fileprivate func foldsOnceToTheSharedKey(_ fold: FoldCase) {
        #expect(FoldedText(fold.input).units == Array(fold.key.utf16))
    }

    @Test func comparesFoldedValuesAsFoldingEachTimeDoes() {
        let values =
            [
                "Irish", " \u{CD}RISH ", "F\u{EA}te", "Fe\u{302}te", "Stra\u{DF}e", "Strasse", "\u{131}", "i",
                "The \u{C9}t\u{E9} Waltz", "ete wal", "  ete  ", "ete  waltz", "Οδοσάκης", "ΟΔΟΣ", "\u{3C2}",
                "\u{3C3}", "", "   ", "\u{300}", "Reel", "REEL", "e\u{301}", "\u{FEFF}Reel\u{A0}", "aaab", "aab",
            ] + foldCases.map(\.input)
        for a in values {
            for b in values {
                let folded = (a: foldText(a), b: foldText(b))
                let same = folded.a.utf16.elementsEqual(folded.b.utf16)
                let contains = folded.b.isEmpty || folded.a.utf16.firstRange(of: folded.b.utf16) != nil
                #expect(sameText(FoldedText(a), FoldedText(b)) == same)
                #expect(sameText(a, b) == same)
                #expect(containsText(FoldedText(a), FoldedText(b)) == contains)
                #expect(containsText(a, b) == contains)
            }
        }
    }

    @Test func findsAnEmptyFoldedNeedleInAnything() {
        #expect(containsText(FoldedText("Reel"), FoldedText("")))
        #expect(containsText(FoldedText(""), FoldedText(" \u{300} ")))
        #expect(FoldedText(" \u{300} ").isEmpty)
    }

    @Test func trimsTheWhitespaceJavaScriptTrims() {
        #expect(trimmedText("\u{FEFF}\u{A0} Reel\u{2028}\u{3000}") == "Reel")
        #expect(trimmedText("Mentor\u{85}") == "Mentor\u{85}")
    }
}
