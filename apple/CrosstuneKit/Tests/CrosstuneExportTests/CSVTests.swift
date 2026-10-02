import Testing

@testable import CrosstuneExport

private let bom = "\u{FEFF}"

@Suite struct CSVTests {
    @Test func quotesOnlyFieldsThatNeedItAndDoublesInnerQuotes() {
        #expect(csvDocument([["a", "b,c", "say \"hi\"", "x\ny"]]) == "\(bom)a,\"b,c\",\"say \"\"hi\"\"\",\"x\ny\"\r\n")
    }

    @Test func keepsALeadingEqualsOrDashAsWritten() {
        #expect(csvDocument([["=SUM(A1)", "- note"]]) == "\(bom)=SUM(A1),- note\r\n")
    }

    @Test func normalizesCRLFInsideAFieldToLF() {
        #expect(csvDocument([["a\r\nb"]]) == "\(bom)\"a\nb\"\r\n")
    }

    @Test func turnsALoneCarriageReturnInsideAFieldIntoLF() {
        #expect(csvDocument([["a\rb", "c\r\r\nd"]]) == "\(bom)\"a\nb\",\"c\n\nd\"\r\n")
    }

    @Test func endsEveryRecordWithCRLFAndAnEmptyDocumentIsOnlyTheBOM() {
        #expect(csvDocument([["a"], ["b"]]) == "\(bom)a\r\nb\r\n")
        #expect(csvDocument([]) == bom)
    }
}
