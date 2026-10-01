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

    struct DragCase: Sendable {
        let anchor: Int64
        let pointer: Int64
        let expected: LoopSpan
    }

    @Test(arguments: [
        DragCase(anchor: 5000, pointer: 3000, expected: span(3000, 5000)),
        DragCase(anchor: 5000, pointer: 5100, expected: span(5000, 5500)),
        DragCase(anchor: 60900, pointer: 61000, expected: span(60500, 61000)),
    ])
    func fromDrag(_ c: DragCase) {
        #expect(LoopModel.fromDrag(anchor: c.anchor, pointer: c.pointer, bounds: bounds) == c.expected)
    }

    @Test(arguments: [
        (span(2000, 4000), Int64(-5000), span(1000, 3000)),
        (span(2000, 4000), Int64(60000), span(59000, 61000)),
    ])
    func move(_ input: LoopSpan, _ delta: Int64, _ expected: LoopSpan) {
        #expect(LoopModel.move(input, by: delta, bounds: bounds) == expected)
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

    @Test func stackRowsUsesLowestFreeRow() {
        let rows = LoopModel.stackRows([
            placed("a", 0, 10), placed("b", 5, 15), placed("c", 12, 20), placed("d", 16, 18),
        ])
        #expect(rows == ["a": 0, "b": 1, "c": 0, "d": 1])
    }

    @Test func stackRowsTreatsTouchingAsNonOverlapping() {
        #expect(LoopModel.stackRows([placed("a", 0, 10), placed("b", 10, 20)]) == ["a": 0, "b": 0])
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
}
