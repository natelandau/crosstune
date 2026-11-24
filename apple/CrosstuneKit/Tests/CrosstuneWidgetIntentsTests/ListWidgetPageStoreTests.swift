import CrosstuneTestSupport
import CrosstuneWidgetData
import Testing

@testable import CrosstuneWidgetIntents

struct ListWidgetPageStoreTests {
    let suite = TemporaryDefaults("ListWidgetPageStoreTests")

    @Test func aFlippedPageStaysUntilTheTuneChanges() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        _ = store.page(showing: Self.state(tuneID: "t1"), size: .large)
        store.setPage(2, forList: "list_1", size: .large)
        #expect(store.page(showing: Self.state(tuneID: "t1"), size: .large) == 2)
    }

    @Test func aFlippedPageStaysWhenAnEditMovesTheCurrentTune() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        _ = store.page(showing: Self.state(tuneID: "t1"), size: .large)
        store.setPage(2, forList: "list_1", size: .large)
        let moved = ["t0", "t2", "t3", "t4", "t5", "t6", "t1"] + (7..<30).map { "t\($0)" }
        #expect(store.page(showing: Self.state(tuneID: "t1", tuneIDs: moved), size: .large) == 2)
    }

    @Test func theCurrentTunesPageWinsWhenTheTuneChanges() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        _ = store.page(showing: Self.state(tuneID: "t1"), size: .large)
        store.setPage(2, forList: "list_1", size: .large)
        #expect(store.page(showing: Self.state(tuneID: "t2"), size: .large) == 0)
    }

    @Test func aStoredPageClampsWhenTheListShrinks() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        store.setPage(2, forList: "list_1", size: .large)
        let shrunk = Self.state(tuneID: nil, tuneIDs: (0..<6).map { "t\($0)" })
        #expect(store.page(showing: shrunk, size: .large) == 1)
    }

    /// The list of `tuneIDs` playing `tuneID`, or not playing when `tuneID` is nil.
    private static func state(tuneID: String?, tuneIDs: [String] = (0..<30).map { "t\($0)" }) -> ListWidgetState {
        let tunes = tuneIDs.map { WidgetListTune(id: $0, title: "Tune \($0)", detail: nil) }
        let playback = tuneID.map {
            WidgetListPlayback(
                listID: "list_1", currentTuneID: $0, isPlaying: true, position: 1, count: tunes.count, nextTuneID: nil)
        }
        let summary = WidgetSummary(
            recordingsPlay: true, recordings: [], lists: [WidgetList(id: "list_1", name: "Practice", tunes: tunes)],
            tunerReferenceLabel: nil, recording: nil, recordingFreshUntil: nil, listPlayback: playback)
        return ListWidgetState(summary: summary, listID: "list_1")
    }

    @Test func aPagingSizeJumpsToThePageHoldingTheCurrentTune() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        #expect(store.page(showing: Self.state(tuneID: "t7"), size: .large) == 1)
    }

    /// A medium widget of the same list must not take the tune change from a large one.
    @Test func aSizeWithNoPagesLeavesTheFollowedTuneAlone() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        #expect(store.page(showing: Self.state(tuneID: "t7"), size: .medium) == 0)
        #expect(store.page(showing: Self.state(tuneID: "t7"), size: .large) == 1)
    }

    @Test func eachSizeOfAListKeepsItsOwnPage() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        #expect(store.page(showing: Self.state(tuneID: "t13"), size: .large) == 2)
        #expect(store.page(showing: Self.state(tuneID: "t13"), size: .extraLarge) == 1)
        store.setPage(0, forList: "list_1", size: .large)
        #expect(store.page(showing: Self.state(tuneID: "t13"), size: .extraLarge) == 1)
    }

    @Test func aNewPlaybackOnTheLastFollowedTuneJumpsToItsPage() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        _ = store.page(showing: Self.state(tuneID: "t0"), size: .large)
        store.setPage(2, forList: "list_1", size: .large)
        _ = store.page(showing: Self.state(tuneID: nil), size: .large)
        #expect(store.page(showing: Self.state(tuneID: "t0"), size: .large) == 0)
    }

    /// A deleted list's pages go when the summary is written, and the lists still there keep theirs.
    @Test func keepingListsDropsOnlyTheOthersPages() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        _ = store.page(showing: Self.state(tuneID: "t7"), size: .large)
        store.setPage(2, forList: "list_gone", size: .large)
        store.keepPages(forLists: ["list_1"])
        #expect(store.storedPage(forList: "list_1", size: .large) == 1)
        #expect(store.storedPage(forList: "list_gone", size: .large) == nil)
        #expect(suite.defaults.dictionaryRepresentation().keys.contains { $0.hasSuffix(".list_gone") } == false)
    }

    @Test func signOutRemovesEveryPage() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        _ = store.page(showing: Self.state(tuneID: "t7"), size: .large)
        store.setPage(2, forList: "list_2", size: .extraLarge)
        suite.defaults.set(true, forKey: "unrelated")
        store.removeAllPages()
        #expect(suite.defaults.dictionaryRepresentation().keys.contains { $0.hasPrefix("listWidget.") } == false)
        #expect(suite.defaults.bool(forKey: "unrelated"))
    }

    /// A timeline with a later moment where the list no longer plays must not forget the
    /// followed tune, or each reload would snap a flipped page back to the playing tune's.
    @Test func aTimelineKeepsAFlippedPageAcrossReloads() {
        let store = ListWidgetPageStore(defaults: suite.defaults)
        let summary = { (state: ListWidgetState) -> CurrentWidgetSummary in
            guard case .active(let list, let playback) = state else {
                return .available(Self.summary(list: state.list, playback: nil))
            }
            return .available(Self.summary(list: list, playback: playback))
        }
        let timeline = [
            WidgetMoment(date: .distantPast, current: summary(Self.state(tuneID: "t7"))),
            WidgetMoment(date: .distantFuture, current: summary(Self.state(tuneID: nil))),
        ]
        _ = store.page(for: timeline, listID: "list_1", size: .large)
        store.setPage(2, forList: "list_1", size: .large)

        let firstReload = store.page(for: timeline, listID: "list_1", size: .large)
        let secondReload = store.page(for: timeline, listID: "list_1", size: .large)

        #expect(firstReload == 2)
        #expect(secondReload == 2)
    }

    private static func summary(list: WidgetList?, playback: WidgetListPlayback?) -> WidgetSummary {
        WidgetSummary(
            recordingsPlay: true, recordings: [], lists: list.map { [$0] } ?? [], tunerReferenceLabel: nil,
            recording: nil, recordingFreshUntil: nil, listPlayback: playback)
    }
}
