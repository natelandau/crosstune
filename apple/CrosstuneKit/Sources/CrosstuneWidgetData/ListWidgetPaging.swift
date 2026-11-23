/// How many tunes the List widget fits at each size.
/// The raw value names the size in a page button's intent and in the stored page's key.
public enum ListWidgetSize: String, CaseIterable, Sendable {
    case small, medium, large, extraLarge

    /// Use it to size a page. Zero means the size shows no tunes.
    public var tunesPerPage: Int {
        switch self {
        case .small: 0
        case .medium: 2
        case .large: 5
        case .extraLarge: 12
        }
    }

    /// True for the sizes with page buttons. The others show their first tunes, or follow the
    /// playing tune, and never read or move the stored page.
    public var showsPages: Bool { self == .large || self == .extraLarge }
}

/// Splits a list's tunes into pages so the widget's paging buttons and the playing tune agree on
/// which page shows.
public struct ListWidgetPaging: Equatable, Sendable {
    public let pageSize: Int
    public let tuneCount: Int

    public init(pageSize: Int, tuneCount: Int) {
        self.pageSize = pageSize
        self.tuneCount = tuneCount
    }

    /// At least 1, so an empty list still has a page.
    public var pageCount: Int {
        guard pageSize > 0 else { return 1 }
        return max(1, (tuneCount + pageSize - 1) / pageSize)
    }

    /// Use it to keep a stored page valid after the list shrinks.
    public func clamped(_ page: Int) -> Int {
        min(max(page, 0), pageCount - 1)
    }

    /// The tune indexes on `page`.
    public func range(of page: Int) -> Range<Int> {
        let start = min(clamped(page) * pageSize, tuneCount)
        return start..<min(start + pageSize, tuneCount)
    }

    /// The page that shows the tune at `index`.
    public func page(holding index: Int) -> Int {
        guard pageSize > 0 else { return 0 }
        return clamped(index / pageSize)
    }
}
