import Testing

@testable import CrosstuneWidgetData

struct ListWidgetStateTests {
    enum Playback: Sendable {
        case none, playing, paused, otherList
    }

    enum Expected: Sendable {
        case chooseList, empty, ready, active
    }

    static func tunes(_ count: Int) -> [WidgetListTune] {
        (0..<count).map { WidgetListTune(id: "t\($0)", title: "Tune \($0)", detail: nil) }
    }

    static func summary(tuneCount: Int, playback: Playback, current: String = "t1", next: String? = "t2")
        -> WidgetSummary
    {
        let listPlayback: WidgetListPlayback? =
            switch playback {
            case .none: nil
            case .playing, .paused, .otherList:
                WidgetListPlayback(
                    listID: playback == .otherList ? "other" : "list", currentTuneID: current,
                    isPlaying: playback != .paused, position: 2, count: 12, nextTuneID: next)
            }
        return WidgetSummary(
            recordingsPlay: true, recordings: [],
            lists: [WidgetList(id: "list", name: "Practice", tunes: tunes(tuneCount))],
            tunerReferenceLabel: nil, recording: nil, recordingFreshUntil: nil, listPlayback: listPlayback)
    }

    @Test(
        arguments: [
            (nil, 3, Playback.none, Expected.chooseList),
            ("deleted", 3, .none, .chooseList),
            ("list", 0, .none, .empty),
            ("list", 3, .none, .ready),
            ("list", 3, .otherList, .ready),
            ("list", 3, .playing, .active),
            ("list", 3, .paused, .active),
            // A list emptied while it plays still offers Pause.
            ("list", 0, .playing, .active),
        ] as [(String?, Int, Playback, Expected)])
    func theStateFollowsTheChosenListAndItsPlayback(
        listID: String?, tuneCount: Int, playback: Playback, expected: Expected
    ) {
        let state = ListWidgetState(summary: Self.summary(tuneCount: tuneCount, playback: playback), listID: listID)
        switch (state, expected) {
        case (.chooseList, .chooseList), (.empty, .empty), (.ready, .ready), (.active, .active): break
        default: Issue.record("expected \(expected), got \(state)")
        }
    }

    @Test(
        arguments: [
            (3, Playback.none, ListWidgetCount.tunes(3)),
            (3, .playing, .position(2, of: 12)),
            (3, .paused, .position(2, of: 12)),
            (0, .none, nil),
        ] as [(Int, Playback, ListWidgetCount?)])
    func theHeadingCountsTunesOrThePlayOrder(tuneCount: Int, playback: Playback, expected: ListWidgetCount?) {
        let state = ListWidgetState(summary: Self.summary(tuneCount: tuneCount, playback: playback), listID: "list")
        #expect(state.count == expected)
    }

    @Test(
        arguments: [
            (
                "list", 3, Playback.none, ListWidgetAction?.some(.play(shuffled: false)),
                ListWidgetAction.play(shuffled: false)
            ),
            ("list", 3, .playing, .pause, .openApp),
            ("list", 3, .paused, .resume, .resume),
            ("list", 0, .none, nil, .openList),
            (nil, 3, .none, nil, .openApp),
        ] as [(String?, Int, Playback, ListWidgetAction?, ListWidgetAction)])
    func playAndTheLockScreenTapFollowThePlayback(
        listID: String?, tuneCount: Int, playback: Playback, play: ListWidgetAction?, lockScreen: ListWidgetAction
    ) {
        let state = ListWidgetState(summary: Self.summary(tuneCount: tuneCount, playback: playback), listID: listID)
        #expect(state.playButton == play)
        #expect(state.lockScreenTap == lockScreen)
    }

    @Test(
        arguments: [
            (ListWidgetSize.small, 12, Playback.none, "t1", "t2", 0, [String]()),
            (.medium, 12, .none, "t1", "t2", 0, ["t0", "t1"]),
            (.medium, 12, .playing, "t4", "t9", 0, ["t4", "t9"]),
            (.medium, 12, .paused, "t11", nil, 0, ["t11"]),
            (.medium, 12, .playing, "gone", "t3", 0, ["t0", "t1"]),
            (.large, 12, .none, "t1", "t2", 1, ["t5", "t6", "t7", "t8", "t9"]),
            (.large, 12, .playing, "t1", "t2", 2, ["t10", "t11"]),
            (.extraLarge, 13, .none, "t1", "t2", 0, (0..<12).map { "t\($0)" }),
        ] as [(ListWidgetSize, Int, Playback, String, String?, Int, [String])])
    func eachSizeShowsItsTunes(
        size: ListWidgetSize, tuneCount: Int, playback: Playback, current: String, next: String?, page: Int,
        expected: [String]
    ) {
        let summary = Self.summary(tuneCount: tuneCount, playback: playback, current: current, next: next)
        let state = ListWidgetState(summary: summary, listID: "list")
        #expect(state.tunes(for: size, page: page).map(\.id) == expected)
    }

    @Test(
        arguments: [
            (ListWidgetSize.large, 12, 0, ListWidgetPager?.some(ListWidgetPager(page: 0, pageCount: 3))),
            (.large, 12, 2, ListWidgetPager(page: 2, pageCount: 3)),
            (.large, 5, 0, nil),
            (.extraLarge, 12, 0, nil),
            (.extraLarge, 13, 1, ListWidgetPager(page: 1, pageCount: 2)),
            (.medium, 12, 0, nil),
        ] as [(ListWidgetSize, Int, Int, ListWidgetPager?)])
    func pageButtonsShowOnlyWhenTheListHasMorePages(
        size: ListWidgetSize, tuneCount: Int, page: Int, expected: ListWidgetPager?
    ) {
        let state = ListWidgetState(summary: Self.summary(tuneCount: tuneCount, playback: .none), listID: "list")
        #expect(state.pager(for: size, page: page) == expected)
    }

    @Test(arguments: [(0, nil, 1), (1, 0, 2), (2, 1, nil)] as [(Int, Int?, Int?)])
    func pageButtonsStopAtTheEnds(page: Int, previous: Int?, next: Int?) {
        let pager = ListWidgetPager(page: page, pageCount: 3)
        #expect(pager.previousPage == previous)
        #expect(pager.nextPage == next)
    }
}
