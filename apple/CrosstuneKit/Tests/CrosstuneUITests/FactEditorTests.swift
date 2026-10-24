import Testing

@testable import CrosstuneUI

@Suite struct FactEditorTests {
    typealias Ending = FactEditSession<String>.Ending

    private static let saving: [Ending] = [.picked, .dismissed, .done, .swipedDown, .unmounted]
    private static let discarding: [Ending] = [.escaped]

    @Test func everyEndingButEscapeIsListed() {
        #expect(Set(Self.saving + Self.discarding) == Set(Ending.allCases))
    }

    @Test(arguments: saving)
    func aSavingEndingReturnsTheChangedDraft(_ ending: Ending) {
        var session = FactEditSession.text("Reel")
        session.draft = "Jig"
        #expect(session.end(ending) == "Jig")
    }

    @Test(arguments: discarding)
    func escapeDiscardsTheDraft(_ ending: Ending) {
        var session = FactEditSession.text("Reel")
        session.draft = "Jig"
        #expect(session.end(ending) == nil)
    }

    @Test(arguments: saving)
    func anUnchangedDraftWritesNothing(_ ending: Ending) {
        var session = FactEditSession.text("Reel")
        #expect(session.end(ending) == nil)
    }

    @Test func theDraftSavesTrimmed() {
        var session = FactEditSession.text("Reel")
        session.draft = "  Jig \n"
        #expect(session.end(.done) == "Jig")
    }

    @Test func aDraftThatDiffersOnlyInSpaceWritesNothing() {
        var session = FactEditSession.text("Reel")
        session.draft = " Reel  "
        #expect(session.end(.dismissed) == nil)
    }

    @Test func aStoredValueWithSpaceStillComparesTrimmed() {
        var session = FactEditSession.text(" Reel ")
        session.draft = "Reel"
        #expect(session.end(.done) == nil)
    }

    @Test func clearingAFactSavesTheEmptyValue() {
        var session = FactEditSession.text("Reel")
        session.draft = "   "
        #expect(session.end(.done) == "")
    }

    @Test func aNonTextValueComparesAsItIs() {
        var session = FactEditSession(stored: false)
        session.draft = true
        #expect(session.end(.picked) == true)
        var unchanged = FactEditSession(stored: ["dorian"])
        #expect(unchanged.end(.done) == nil)
    }

    /// The content's disappearance follows every explicit ending, so it must save nothing more.
    @Test(arguments: saving + discarding)
    func theDisappearanceAfterAnEndingSavesNothing(_ ending: Ending) {
        var session = FactEditSession.text("Reel")
        session.draft = "Jig"
        _ = session.end(ending)
        #expect(session.end(.unmounted) == nil)
        #expect(session.end(.dismissed) == nil)
        #expect(session.isEnded)
    }

    @Test func aDraftTypedAfterTheEndSavesNothing() {
        var session = FactEditSession.text("Reel")
        _ = session.end(.done)
        session.draft = "Jig"
        #expect(session.end(.dismissed) == nil)
    }

    /// The editor's sequence: an explicit ending, then the disappearance every closing brings.
    private func commits(_ ending: Ending, picked: String? = nil, draft: String = "Jig") -> [String] {
        var session = FactEditSession.text("Reel")
        session.draft = draft
        var committed: [String] = []
        session.end(ending, picked: picked) { committed.append($0) }
        session.end(.leaving(stillPresented: false, asSheet: false)) { committed.append($0) }
        return committed
    }

    @Test func doneThenTheDisappearanceCommitsOnce() {
        #expect(commits(.done) == ["Jig"])
    }

    @Test func aPickThenTheDisappearanceCommitsThePickOnce() {
        #expect(commits(.picked, picked: "Hornpipe") == ["Hornpipe"])
    }

    @Test(arguments: discarding)
    func escapeThenTheDisappearanceCommitsNothing(_ ending: Ending) {
        #expect(commits(ending).isEmpty)
    }

    @Test func aDisappearanceAloneCommitsTheDraftOnce() {
        var session = FactEditSession.text("Reel")
        session.draft = "Jig"
        var committed: [String] = []
        session.end(.leaving(stillPresented: true, asSheet: false)) { committed.append($0) }
        session.end(.leaving(stillPresented: false, asSheet: false)) { committed.append($0) }
        #expect(committed == ["Jig"])
    }

    @Test func aPickOfTheStoredValueCommitsNothing() {
        #expect(commits(.picked, picked: "Reel").isEmpty)
    }

    @Test func theDisappearanceNamesHowTheEditorLeft() {
        #expect(Ending.leaving(stillPresented: true, asSheet: true) == .unmounted)
        #expect(Ending.leaving(stillPresented: true, asSheet: false) == .unmounted)
        #expect(Ending.leaving(stillPresented: false, asSheet: true) == .swipedDown)
        #expect(Ending.leaving(stillPresented: false, asSheet: false) == .dismissed)
    }
}
