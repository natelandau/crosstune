import Testing

@testable import CrosstuneWidgetData

struct ListWidgetPagingTests {
    @Test(arguments: [(5, 0, 1), (5, 5, 1), (5, 6, 2), (5, 12, 3), (12, 12, 1), (12, 13, 2), (0, 10, 1)])
    func pageCount(pageSize: Int, tuneCount: Int, expected: Int) {
        #expect(ListWidgetPaging(pageSize: pageSize, tuneCount: tuneCount).pageCount == expected)
    }

    @Test(arguments: [(0, 0..<5), (2, 10..<12)])
    func rangeOfAPage(page: Int, expected: Range<Int>) {
        #expect(ListWidgetPaging(pageSize: 5, tuneCount: 12).range(of: page) == expected)
    }

    @Test(arguments: [(4, 1), (-1, 0)])
    func clampedPage(page: Int, expected: Int) {
        #expect(ListWidgetPaging(pageSize: 5, tuneCount: 6).clamped(page) == expected)
    }

    @Test(arguments: [(7, 1), (0, 0)])
    func pageHoldingAnIndex(index: Int, expected: Int) {
        #expect(ListWidgetPaging(pageSize: 5, tuneCount: 12).page(holding: index) == expected)
    }

    @Test func pageHoldingAnIndexIsZeroWhenNoTunesFit() {
        #expect(ListWidgetPaging(pageSize: 0, tuneCount: 10).page(holding: 3) == 0)
    }
}
