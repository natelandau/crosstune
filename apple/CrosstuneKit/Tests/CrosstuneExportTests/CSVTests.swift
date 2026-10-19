import Testing

@testable import CrosstuneExport

private let bom = "\u{FEFF}"

@Suite struct CSVTests {
    @Test func quotesOnlyFieldsThatNeedItAndDoublesInnerQuotes() {
        #expect(csvDocument([["a", "b,c", "say \"hi\"", "x\ny"]]) == "\(bom)a,\"b,c\",\"say \"\"hi\"\"\",\"x\ny\"\r\n")
    }

    @Test func guardsACellASpreadsheetWouldReadAsAFormula() {
        #expect(
            csvDocument([["=SUM(A1)", "+1 555", "- note", "@user", "\tx", "\rx"]])
                == "\(bom)'=SUM(A1),'+1 555,'- note,'@user,'\tx,\"'\nx\"\r\n")
    }

    @Test func leavesANumberAsWritten() {
        #expect(csvDocument([["-80.92", "+5", "-0.5", "36", "-.5"]]) == "\(bom)-80.92,+5,-0.5,36,-.5\r\n")
    }

    @Test func guardsACellASpreadsheetWouldReadAsADate() {
        #expect(
            csvDocument([["6/8", "12/8", "1/2/2026", "6/8 jig", "2026-03-14", "6/"]])
                == "\(bom)'6/8,'12/8,'1/2/2026,6/8 jig,2026-03-14,6/\r\n")
    }

    @Test func guardsAFormulaThatAlsoNeedsQuotes() {
        #expect(csvDocument([["=A1,\"x\""]]) == "\(bom)\"'=A1,\"\"x\"\"\"\r\n")
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
