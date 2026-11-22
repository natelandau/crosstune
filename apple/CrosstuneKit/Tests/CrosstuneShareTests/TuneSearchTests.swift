import CrosstuneShare
import Testing

struct TuneSearchTests {
    @Test func matchesFoldedTitlesAndKeepsTheCreateRow() {
        let drowsy = ShareTuneEntry(id: "t1", title: "Drowsy Maggie", detail: nil)
        let jig = ShareTuneEntry(id: "t2", title: "Maggie's Jig", detail: "Jig")

        #expect(TuneSearch([drowsy, jig]).results("drowsy MAGGIE") == [drowsy])
        #expect(TuneSearch.offersCreate("Drowsy Maggie"))
        #expect(!TuneSearch.offersCreate("  "))
    }
}
