/// What a List widget shows and what its controls do, from the summary and the list the widget
/// was set up with.
public enum ListWidgetState: Equatable, Sendable {
    /// No list picked yet, or the picked list was deleted.
    case chooseList
    case empty(WidgetList)
    case ready(WidgetList)
    /// The list is playing or paused.
    case active(WidgetList, WidgetListPlayback)

    /// Playback comes before an empty list, so a list emptied while it plays still offers Pause.
    public init(summary: WidgetSummary, listID: String?) {
        guard let listID, let list = summary.lists.first(where: { $0.id == listID }) else {
            self = .chooseList
            return
        }
        if let playback = summary.listPlayback, playback.listID == list.id {
            self = .active(list, playback)
        } else if list.tunes.isEmpty {
            self = .empty(list)
        } else {
            self = .ready(list)
        }
    }

    public var list: WidgetList? {
        switch self {
        case .chooseList: nil
        case .empty(let list), .ready(let list), .active(let list, _): list
        }
    }

    public var playback: WidgetListPlayback? {
        if case .active(_, let playback) = self { playback } else { nil }
    }

    /// The count beside the list name, or nil when the state shows none.
    public var count: ListWidgetCount? {
        switch self {
        case .chooseList, .empty: nil
        case .ready(let list): .tunes(list.tunes.count)
        case .active(_, let playback): .position(playback.position, of: playback.count)
        }
    }

    /// What Play does, or nil when the state shows no Play.
    public var playButton: ListWidgetAction? {
        switch self {
        case .chooseList, .empty: nil
        case .ready: .play(shuffled: false)
        case .active(_, let playback): playback.isPlaying ? .pause : .resume
        }
    }

    /// The lock screen rectangle is one tap target, so it does the one thing that fits the state.
    public var lockScreenTap: ListWidgetAction {
        switch self {
        case .chooseList: .openApp
        case .empty: .openList
        case .ready: .play(shuffled: false)
        case .active(_, let playback): playback.isPlaying ? .openApp : .resume
        }
    }

    /// The tune the list is on, or nil when it is not active or the tune left the list.
    public var currentTune: WidgetListTune? {
        guard let playback, let list else { return nil }
        return list.tunes.first { $0.id == playback.currentTuneID }
    }

    /// The current tune's place in list order, which picks the page that shows it.
    public var currentTuneIndex: Int? {
        guard let playback, let list else { return nil }
        return list.tunes.firstIndex { $0.id == playback.currentTuneID }
    }

    public func paging(for size: ListWidgetSize) -> ListWidgetPaging {
        ListWidgetPaging(pageSize: size.tunesPerPage, tuneCount: list?.tunes.count ?? 0)
    }

    /// The rows at `size`. While active, medium shows the current and next tune in play order,
    /// which can differ from list order. The paging sizes show `page` in list order.
    public func tunes(for size: ListWidgetSize, page: Int) -> [WidgetListTune] {
        guard let list else { return [] }
        if size == .medium, let playback, let current = currentTune {
            let next = playback.nextTuneID.flatMap { id in list.tunes.first { $0.id == id } }
            return [current] + (next.map { [$0] } ?? [])
        }
        let range = paging(for: size).range(of: size.showsPages ? page : 0)
        return Array(list.tunes[range])
    }

    /// The page buttons, or nil when `size` has no pages or the list fits on one.
    public func pager(for size: ListWidgetSize, page: Int) -> ListWidgetPager? {
        let paging = paging(for: size)
        guard size.showsPages, paging.pageCount > 1 else { return nil }
        return ListWidgetPager(page: paging.clamped(page), pageCount: paging.pageCount)
    }
}

/// The count beside a list's name: its tunes, or where playback is in the play order.
public enum ListWidgetCount: Equatable, Sendable {
    case tunes(Int)
    case position(Int, of: Int)
}

/// What a List widget control runs.
public enum ListWidgetAction: Equatable, Sendable {
    case play(shuffled: Bool)
    case pause
    case resume
    case openList
    case openApp
}

/// The page buttons along the bottom of a paging List widget.
public struct ListWidgetPager: Equatable, Sendable {
    /// Counting from 0.
    public let page: Int
    public let pageCount: Int

    public init(page: Int, pageCount: Int) {
        self.page = page
        self.pageCount = pageCount
    }

    /// Nil on the first page.
    public var previousPage: Int? { page > 0 ? page - 1 : nil }
    /// Nil on the last page.
    public var nextPage: Int? { page < pageCount - 1 ? page + 1 : nil }
}
