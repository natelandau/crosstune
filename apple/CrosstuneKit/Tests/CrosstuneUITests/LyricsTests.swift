import CrosstuneStore
import CrosstuneTestSupport
import GRDB
import Testing

@testable import CrosstuneUI

@Suite struct LyricLinesTests {
    @Test func splitsVersesOnABlankLineAndKeepsEachLine() {
        #expect(LyricLines.lines("one\ntwo\n\nthree") == [["one", "two"], ["three"]])
    }

    @Test func collapsesARunOfBlankLinesToOneVerseBreak() {
        #expect(LyricLines.lines("one\n\n\n\ntwo") == [["one"], ["two"]])
    }

    @Test func normalizesCRLFAndTrimsTheEnds() {
        #expect(LyricLines.lines("\r\n\r\none\r\ntwo\r\n\r\n") == [["one", "two"]])
    }

    @Test func dropsTheSpacesAroundALineWithoutTouchingItsWords() {
        #expect(LyricLines.lines("one   \n  two three ") == [["one", "two three"]])
    }

    @Test func readsAMissingOrBlankBodyAsNoLyrics() {
        #expect(LyricLines.lines(nil) == [])
        #expect(LyricLines.lines("   \n\n  ") == [])
    }
}

@Suite struct LyricOpeningTests {
    @Test func takesTheFirstLinesAcrossVerses() {
        #expect(LyricLines.opening("one\ntwo\n\nthree", count: 2) == ["one", "two"])
        #expect(LyricLines.opening("one\n\ntwo\nthree", count: 3) == ["one", "two", "three"])
    }

    @Test func givesNothingForAMissingBody() {
        #expect(LyricLines.opening(nil, count: 2) == [])
    }

    @Test func givesNothingForANegativeCountRatherThanEveryLineButTheLast() {
        #expect(LyricLines.opening("one\ntwo\nthree", count: -1) == [])
    }
}

@Suite struct LyricsSizeTests {
    @Test func clampsAStepToTheEndsOfTheScale() {
        #expect(LyricsSize.clamp(0) == 1)
        #expect(LyricsSize.clamp(1) == 1)
        #expect(LyricsSize.clamp(LyricsSize.steps) == LyricsSize.steps)
        #expect(LyricsSize.clamp(99) == LyricsSize.steps)
    }

    @Test func growsWithEachStep() {
        let sizes = (1...LyricsSize.steps).map(LyricsSize.pointSize(for:))
        #expect(sizes == sizes.sorted())
        #expect(Set(sizes).count == sizes.count)
    }

    @Test func clampsAnOutOfRangeStepBeforeSizingIt() {
        #expect(LyricsSize.pointSize(for: 0) == LyricsSize.pointSize(for: 1))
        #expect(LyricsSize.pointSize(for: 99) == LyricsSize.pointSize(for: LyricsSize.steps))
    }
}

@MainActor
@Suite struct LyricsReaderModelTests {
    /// Waits for the model's live query to catch up with the store.
    private func eventually(_ condition: @MainActor () -> Bool) async throws {
        #expect(try await poll { condition() })
    }

    private let soldiersJoy = SampleCatalog.entries[0]

    @Test func savesOnlyTheLyricsFieldAndQueuesOneChange() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        try await store.write { writer in _ = try OutboxEntry.deleteAll(writer.db) }
        let model = LyricsReaderModel(store: store, tuneID: soldiersJoy.tune.id)
        try await eventually { model.phase != .loading }

        let saved = await model.save("New words entirely")
        #expect(saved)
        #expect(model.failure == nil)
        try await eventually {
            if case .shown(_, let lyrics) = model.phase { lyrics == "New words entirely" } else { false }
        }

        let tune = try await store.read { db in try Tune.fetchOne(db, key: soldiersJoy.tune.id) }
        #expect(tune?.lyrics == "New words entirely")
        #expect(tune?.title == soldiersJoy.tune.title)
        #expect(tune?.key == soldiersJoy.tune.key)
        #expect(try await store.read { db in try OutboxEntry.fetchCount(db) } == 1)
    }

    @Test func savesWhitespaceOnlyWordsAsNoLyrics() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        let model = LyricsReaderModel(store: store, tuneID: soldiersJoy.tune.id)
        try await eventually { model.phase != .loading }

        #expect(await model.save("   \n  "))
        let tune = try await store.read { db in try Tune.fetchOne(db, key: soldiersJoy.tune.id) }
        #expect(tune?.lyrics == nil)
    }
}
