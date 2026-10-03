import CrosstuneStore
import Foundation
import Testing

private let bounds = LoopSpan(startMs: 1000, endMs: 61000)
private func span(_ start: Int64, _ end: Int64) -> LoopSpan { LoopSpan(startMs: start, endMs: end) }
private func placed(_ id: String, _ start: Int64, _ end: Int64, _ color: Int = 0) -> PlacedLoop {
    PlacedLoop(id: id, span: span(start, end), color: color)
}

@Suite struct LoopModelTests {
    struct ClampCase: Sendable {
        let input: LoopSpan
        let expected: LoopSpan?
    }

    @Test(arguments: [
        ClampCase(input: span(0, 5000), expected: span(1000, 5000)),
        ClampCase(input: span(60800, 70000), expected: nil),
        ClampCase(input: span(60000, 70000), expected: span(60000, 61000)),
    ])
    func clamp(_ c: ClampCase) {
        #expect(LoopModel.clamp(c.input, to: bounds) == c.expected)
    }

    @Test(arguments: [
        (LoopModel.Edge.end, Int64(2100), span(2000, 2500)),
        (LoopModel.Edge.start, Int64(0), span(1000, 4000)),
        (LoopModel.Edge.start, Int64(4800), span(3500, 4000)),
    ])
    func resize(_ edge: LoopModel.Edge, _ to: Int64, _ expected: LoopSpan) {
        #expect(LoopModel.resize(span(2000, 4000), edge: edge, to: to, bounds: bounds) == expected)
    }

    @Test(arguments: [(Int64(10_040), Int64(10_000)), (Int64(10_100), Int64(10_100))])
    func snap(_ ms: Int64, _ expected: Int64) {
        #expect(LoopModel.snap(ms, to: [10_000], msPerPoint: 10) == expected)
    }

    @Test func snapIsInclusiveAtExactlyEightPoints() {
        #expect(LoopModel.snap(10_080, to: [10_000], msPerPoint: 10) == 10_000)
        #expect(LoopModel.snap(10_081, to: [10_000], msPerPoint: 10) == 10_081)
    }

    @Test func pickColorWithNoLoops() {
        #expect(LoopModel.pickColor(for: span(5, 8), among: []) == 0)
    }

    @Test func pickColorAvoidsNeighbors() {
        let loops = [placed("o", 4, 6, 0), placed("before", 0, 3, 1), placed("after", 9, 12, 0)]
        #expect(LoopModel.pickColor(for: span(5, 8), among: loops) == 2)
    }

    @Test func pickColorTiesGoToLowestIndex() {
        let loops = [
            placed("c0", 4, 6, 0), placed("c1", 5, 7, 1), placed("c2", 5, 7, 2),
            placed("c3", 6, 7, 3), placed("c4", 6, 7, 4), placed("c5", 6, 7, 5), placed("c3b", 6, 7, 3),
        ]
        #expect(LoopModel.pickColor(for: span(5, 8), among: loops) == 0)
    }

    @Test func pickColorBreaksNeighborTieByOverallUse() {
        let loops = [
            placed("o0", 4, 6, 0), placed("o1", 5, 7, 1), placed("o2", 5, 7, 2),
            placed("o3", 6, 7, 3), placed("o4", 6, 7, 4), placed("near", 9, 12, 5),
            placed("far1", 100, 200, 0), placed("far2", 300, 400, 0), placed("far3", 500, 600, 1),
        ]
        #expect(LoopModel.pickColor(for: span(5, 8), among: loops) == 2)
    }

    struct PartCase: Sendable {
        let structure: String?
        let used: [String]
        let expected: [String]
    }

    @Test(arguments: [
        PartCase(structure: "AABB", used: [], expected: ["A part", "B part"]),
        PartCase(structure: "aabbcc", used: ["B part"], expected: ["A part", "C part", "B part"]),
        PartCase(structure: "AB(x3)", used: [], expected: ["A part", "B part"]),
        PartCase(structure: "AABB (CC)", used: [], expected: ["A part", "B part"]),
        PartCase(structure: "aabb", used: [], expected: ["A part", "B part"]),
        PartCase(structure: "AABBCC", used: [], expected: ["A part", "B part", "C part"]),
        PartCase(structure: "ABAC", used: [], expected: ["A part", "B part", "C part"]),
        PartCase(structure: "A A B B", used: [], expected: ["A part", "B part"]),
        // ß uppercases to SS, which is no part letter.
        PartCase(structure: "AßB", used: [], expected: ["A part", "B part"]),
        PartCase(structure: "", used: [], expected: []),
        PartCase(structure: nil, used: [], expected: []),
    ])
    func partSuggestions(_ c: PartCase) {
        #expect(LoopModel.partSuggestions(partStructure: c.structure, used: c.used) == c.expected)
    }

    private static let a = placed("a", 10_000, 20_000)
    private static let b = placed("b", 30_000, 40_000)
    private static let ab = [a, b]

    struct LoopAtCase: Sendable {
        let ms: Int64
        let loops: [PlacedLoop]
        let expected: String?
    }

    @Test(arguments: [
        LoopAtCase(ms: 15_000, loops: ab, expected: "a"),
        LoopAtCase(ms: 10_000, loops: ab, expected: "a"),
        LoopAtCase(ms: 20_000, loops: ab, expected: nil),
        LoopAtCase(ms: 20_000, loops: [a, placed("c", 20_000, 25_000), b], expected: "c"),
        LoopAtCase(ms: 25_000, loops: ab, expected: nil),
    ])
    func loopAt(_ c: LoopAtCase) {
        #expect(LoopModel.loop(at: c.ms, in: c.loops)?.id == c.expected)
    }

    @Test(arguments: [(Self.a, span(1000, 30_000)), (Self.b, span(20_000, 61_000))])
    func roomAround(_ loop: PlacedLoop, _ expected: LoopSpan) {
        #expect(LoopModel.room(around: loop.span, in: Self.ab, bounds: bounds) == expected)
    }

    @Test(arguments: [
        (Int64(25_000), span(20_000, 30_000) as LoopSpan?), (Int64(5000), span(1000, 10_000)),
        (Int64(15_000), nil),
    ])
    func freeGap(_ ms: Int64, _ expected: LoopSpan?) {
        #expect(LoopModel.freeGap(at: ms, in: Self.ab, bounds: bounds) == expected)
    }

    struct NewLoopCase: Sendable {
        let ms: Int64
        let loops: [PlacedLoop]
        let expected: LoopModel.NewLoop
    }

    @Test(arguments: [
        NewLoopCase(ms: 25_000, loops: ab, expected: .span(span(21_000, 29_000))),
        NewLoopCase(ms: 21_000, loops: ab, expected: .span(span(20_000, 25_000))),
        NewLoopCase(ms: 3000, loops: ab, expected: .span(span(1000, 7000))),
        NewLoopCase(ms: 15_000, loops: ab, expected: .inside(id: "a")),
        NewLoopCase(ms: 20_250, loops: [a, placed("c", 20_500, 30_000)], expected: .span(span(20_000, 20_500))),
        NewLoopCase(ms: 20_250, loops: [a, placed("c", 20_499, 30_000)], expected: .noRoom),
    ])
    func newLoop(_ c: NewLoopCase) {
        #expect(LoopModel.newLoop(at: c.ms, in: c.loops, bounds: bounds) == c.expected)
    }

    @Test func newLoopAtTheCapWinsOverEverythingElse() {
        let full = (0..<LoopModel.maxLoops).map { placed("l\($0)", Int64($0) * 100, Int64($0) * 100 + 50) }
        #expect(LoopModel.newLoop(at: 15_000, in: full, bounds: bounds) == .atCap)
        #expect(LoopModel.newLoop(at: 50, in: full, bounds: bounds) == .atCap)
    }

    struct AdjacentCase: Sendable {
        let direction: LoopModel.Direction
        let from: Int64
        let selected: String?
        let expected: String?
    }

    @Test(arguments: [
        AdjacentCase(direction: .next, from: 25_000, selected: nil, expected: "b"),
        AdjacentCase(direction: .previous, from: 25_000, selected: nil, expected: "a"),
        AdjacentCase(direction: .previous, from: 10_000, selected: "a", expected: nil),
        AdjacentCase(direction: .previous, from: 15_000, selected: "a", expected: nil),
        AdjacentCase(direction: .next, from: 10_000, selected: "a", expected: "b"),
    ])
    func adjacent(_ c: AdjacentCase) {
        let found = LoopModel.adjacent(c.direction, from: c.from, in: Self.ab, selectedID: c.selected)
        #expect(found?.id == c.expected)
    }

    @Test(arguments: [
        (Self.a, LoopModel.Edge.end, Int64(35_000), span(10_000, 30_000)),
        (Self.b, LoopModel.Edge.start, Int64(15_000), span(20_000, 40_000)),
        (Self.a, LoopModel.Edge.end, Int64(10_200), span(10_000, 10_500)),
    ])
    func resizeInsideRoom(_ loop: PlacedLoop, _ edge: LoopModel.Edge, _ to: Int64, _ expected: LoopSpan) {
        let room = LoopModel.room(around: loop.span, in: Self.ab, bounds: bounds)
        #expect(LoopModel.resize(loop.span, edge: edge, to: to, bounds: room) == expected)
    }
}
