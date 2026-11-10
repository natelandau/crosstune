import CrosstuneStore
import Foundation
import Testing

@testable import CrosstuneDesign

struct RangeEditTests {
    @Test func endsNeverCross() {
        #expect(RangeEdit.start(50, end: 52, minimumLength: 3) == 49)
        #expect(RangeEdit.end(10, start: 12, minimumLength: 3, duration: 195) == 15)
    }

    @Test func edgesStayInsideTheRecording() {
        #expect(RangeEdit.start(-4, end: 52, minimumLength: 3) == 0)
        #expect(RangeEdit.end(250, start: 12, minimumLength: 3, duration: 195) == 195)
    }

    @Test func spanStopsAtTheEnds() {
        let early = RangeEdit.moved(start: 10, end: 40, by: -20, duration: 195)
        #expect(early.start == 0 && early.end == 30)
        let late = RangeEdit.moved(start: 10, end: 40, by: 200, duration: 195)
        #expect(late.start == 165 && late.end == 195)
    }

    @Test func snapsToTheNearestPointInReach() {
        #expect(RangeEdit.snapped(30.4, to: [30, 52], within: 0.5) == 30)
        #expect(RangeEdit.snapped(31, to: [30], within: 0.5) == nil)
        #expect(RangeEdit.snapped(30.3, to: [30, 30.5], within: 0.5) == 30.5)
    }

    @Test func bubbleShowsTenths() {
        #expect(RangeEdit.bubbleText(132.6) == "2:12.6")
        #expect(RangeEdit.bubbleText(5) == "0:05.0")
        #expect(RangeEdit.bubbleText(59.96) == "1:00.0")
    }

    @Test func snapEntryFiresOnEachNewPoint() {
        let path: [Double?] = [nil, 30, 30, nil, 30, 52]
        let fired = zip(path, path.dropFirst()).filter { RangeEdit.enteredSnap(from: $0, to: $1) }
        #expect(fired.count == 3)
    }

    @Test func dragStartsAtTheLoopDistance() {
        #expect(ControlMetrics.dragThreshold == LoopModel.dragThreshold)
        #expect(RangeHandles.snapReach == LoopModel.snapPoints)
    }

    @Test func edgeScrollGrowsDeeperIntoTheZone() {
        #expect(RangeEdit.edgeScrollDepth(atX: 100, width: 300, zone: 24) == 0)
        #expect(RangeEdit.edgeScrollDepth(atX: 12, width: 300, zone: 24) == -0.5)
        #expect(RangeEdit.edgeScrollDepth(atX: -10, width: 300, zone: 24) == -1)
        #expect(RangeEdit.edgeScrollDepth(atX: 294, width: 300, zone: 24) == 0.75)
        #expect(RangeEdit.edgeScrollDepth(atX: 400, width: 300, zone: 24) == 1)
        #expect(RangeEdit.edgeScrollDepth(atX: 0, width: 0, zone: 24) == 0)
    }

    @Test func handleTargetKeepsANarrowSpansMiddle() {
        #expect(RangeEdit.handleReach(span: 300, target: 44, tabWidth: 16) == (outer: 22, inner: 22))
        #expect(RangeEdit.handleReach(span: 30, target: 44, tabWidth: 16) == (outer: 22, inner: 10))
        #expect(RangeEdit.handleReach(span: -5, target: 44, tabWidth: 16) == (outer: 22, inner: 0))
    }

    @Test func spanClosesToItsCenter() {
        let half = RangeEdit.closing(start: 10, end: 30, progress: 0.5)
        #expect(half.start == 15 && half.end == 25)
        let shut = RangeEdit.closing(start: 10, end: 30, progress: 1)
        #expect(shut.start == 20 && shut.end == 20)
    }

    @Test func spanOpensFromThePlayhead() {
        let shut = RangeEdit.opening(start: 10, end: 30, from: 50, progress: 0)
        #expect(shut.start == 50 && shut.end == 50)
        let open = RangeEdit.opening(start: 10, end: 30, from: 50, progress: 1)
        #expect(open.start == 10 && open.end == 30)
    }

    @Test func aSpanWithNoPlayheadOpensFromItsCenter() {
        #expect(RangeEdit.insertAnchor(playhead: nil, start: 10, end: 30, duration: 195) == 20)
        #expect(RangeEdit.insertAnchor(playhead: 50, start: 10, end: 30, duration: 195) == 50)
        #expect(RangeEdit.insertAnchor(playhead: 250, start: 10, end: 30, duration: 195) == 195)
    }

    /// Held arrows sweep an edge, as a slider's do, and the run commits once, where the last
    /// step left it.
    @Test func heldArrowsCommitOnceWhenLetGo() {
        var run = RangeKeySteps()
        #expect(run.end() == nil)
        run.stepped(start: 10.1, end: 30)
        run.stepped(start: 10.2, end: 30)
        run.stepped(start: 10.3, end: 30)
        let committed = run.end()
        #expect(committed?.start == 10.3 && committed?.end == 30)
        #expect(run.end() == nil)
    }

    /// A practice loop moves only by its handles, so a drag inside it scrubs; an isolate band
    /// moves whole; a new loop opens from the playhead.
    @Test func screensUseRangeHandlesForLoopsAndBands() throws {
        func code(_ path: String) throws -> String {
            SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: path)))
        }
        let practice = try code("RecordingScreen/Practice/PracticeWaveform.swift")
        #expect(practice.contains("RangeHandles("))
        #expect(practice.contains("movesSpan: false"))
        #expect(!practice.contains("movesSpan: true"))
        #expect(practice.contains("insertionID: model.insertedID == row.id ? row.id : nil"))
        let isolate = try code("RecordingScreen/IsolateRange.swift")
        #expect(isolate.contains("RangeHandles("))
        #expect(isolate.contains("movesSpan: true"))
        #expect(!isolate.contains("LoopHandleMark"))
    }

    /// Every handle starts a drag only past the waveform's own drag distance, so a click on the
    /// waveform near a handle still moves the playhead.
    @Test func everyHandleStartsADragAtTheWaveformsDistance() throws {
        #expect(ControlMetrics.dragThreshold == LoopModel.dragThreshold)
        let source = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "Phone/Controls/RangeHandles.swift")))
        let distances = source.matches(of: /DragGesture\(minimumDistance: *([\w.]+)/).map { String($0.1) }
        #expect(!distances.isEmpty)
        #expect(distances.allSatisfy { $0 == "ControlMetrics.dragThreshold" }, "\(distances)")
    }

    /// The trim's kept range and Split's cuts also move only by their handles; a cut is one
    /// point that snaps to the line; the trim detail's handles repeat the overview's, so they take
    /// no keyboard focus, and focusing an overview handle shows it in the detail. Save with
    /// nothing changed closes either screen.
    @Test func editorsUseRangeHandlesForTrimAndCuts() throws {
        func code(_ path: String) throws -> String {
            SourceScan.withoutComments(try SourceScan.text(at: SourceScan.url(of: path)))
        }
        func has(_ code: String, _ pattern: String) throws -> Bool {
            code.contains(try Regex(pattern))
        }
        let save = try code("RecordingScreen/EditorSaveButton.swift")
        #expect(try has(save, #"if\s+model\.pressSave\(\)\s*==\s*\.close\s*\{\s*onLeave\(\)\s*\}"#))
        let closesUnchanged = #"EditorSaveButton\((?:[^()]|\([^()]*\))*onLeave:\s*leave\b"#
        let trim = try code("RecordingScreen/TrimScreen.swift")
        #expect(try has(trim, #"RangeHandles\("#))
        #expect(try has(trim, #"movesSpan:\s*false"#))
        #expect(try !has(trim, #"movesSpan:\s*true"#))
        #expect(try has(trim, #"isFocusable:\s*!isDetail"#))
        #expect(try has(trim, #"onFocus:\s*\{\s*model\.selectHandle\(\s*nearestMs:"#))
        #expect(try has(trim, closesUnchanged))
        let cuts = try code("RecordingScreen/CenterLineStrip.swift")
        #expect(try has(cuts, #"RangeHandles\("#))
        #expect(try has(cuts, #"movesSpan:\s*false"#))
        #expect(try has(cuts, #"edges:\s*\.endOnly"#))
        #expect(try has(cuts, #"playhead:\s*seconds\(\s*model\.shownLineMs\s*\)"#))
        let split = try code("RecordingScreen/SplitScreen.swift")
        #expect(try has(split, closesUnchanged))
    }

    /// A view reads the environment its parent gives it, so the closing progress a leaving
    /// span's transition sets on `RangeHandles`'s content reaches only a view inside it.
    @Test func closingProgressIsReadInsideTheTransition() throws {
        let text = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.url(of: "Phone/Controls/RangeHandles.swift")))
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let declaration = try Regex(#"^(?:private |package |fileprivate )?struct (\w+)"#)
        var owner = ""
        var bodies: [String: String] = [:]
        var readers: [String] = []
        for line in lines {
            if let match = line.firstMatch(of: declaration), let name = match.output[1].substring {
                owner = String(name)
            }
            bodies[owner, default: ""] += line + "\n"
            if line.contains("@Environment(\\.rangeClosing)") { readers.append(owner) }
        }
        #expect(!readers.isEmpty)
        for reader in readers {
            #expect(reader != "RangeHandles")
            #expect(
                bodies["RangeHandles", default: ""].contains("\(reader) {")
                    || bodies["RangeHandles", default: ""].contains("\(reader)("))
        }
    }
}
