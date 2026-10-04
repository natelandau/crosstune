import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Synchronization
import Testing

@testable import CrosstuneUI

/// What the scan view log wrote, in order.
@MainActor
private final class ViewsRecorded {
    private(set) var views: [ScanView] = []

    var writer: ScanViewWriter {
        ScanViewWriter(owner: ObjectIdentifier(self)) { [self] in views.append($0) }
    }
}

/// A scan view log on a test clock, writing to `recorded`.
@MainActor
private struct ScanViewRig {
    let clock = ActivityClock()
    let recorded = ViewsRecorded()
    let log: ScanViewLog

    init() {
        let clock = clock
        log = ScanViewLog(clock: { clock.instant }, now: { clock.date })
        log.writer = recorded.writer
    }

    var viewedMs: [Int64] { recorded.views.map(\.viewedMs) }
}

@MainActor
@Suite struct ScanViewLogTests {
    @Test func aLookUnderThreeSecondsWritesNothing() {
        let rig = ScanViewRig()
        rig.log.start(tuneID: "t1", origin: .tune)
        rig.clock.advance(2_999)
        rig.log.end()
        #expect(rig.recorded.views.isEmpty)
    }

    @Test func threeSecondsWritesAView() throws {
        let rig = ScanViewRig()
        rig.log.start(tuneID: "t1", origin: .tune)
        rig.clock.advance(3_000)
        rig.log.end()
        let view = try #require(rig.recorded.views.only)
        #expect(view.tuneID == "t1")
        #expect(view.context == "tune")
        #expect(view.listID == nil)
        #expect(view.startedAt == noon)
        #expect(view.viewedMs == 3_000)
        #expect(view.createdAt == later(3_000))
        #expect(view.serverSeq == nil)
    }

    @Test func endingTwiceWritesOnce() {
        let rig = ScanViewRig()
        rig.log.start(tuneID: "t1", origin: .tune)
        rig.clock.advance(5_000)
        rig.log.end()
        rig.clock.advance(5_000)
        rig.log.end()
        #expect(rig.viewedMs == [5_000])
    }

    @Test func leavingTheForegroundEndsTheViewAndComingBackStartsAnother() {
        let rig = ScanViewRig()
        rig.log.start(tuneID: "t1", origin: .row)
        rig.clock.advance(5_000)
        rig.log.foreground(false)
        #expect(rig.viewedMs == [5_000], "the app may never come back, so the view is written as it leaves")

        // Time in the background counts toward nothing.
        rig.clock.advance(8 * 3_600_000)
        rig.log.foreground(true)
        rig.clock.advance(4_000)
        rig.log.end()

        #expect(rig.viewedMs == [5_000, 4_000])
        #expect(rig.recorded.views.map(\.startedAt) == [noon, later(5_000 + 8 * 3_600_000)])
        #expect(Set(rig.recorded.views.map(\.id)).count == 2)
        #expect(rig.recorded.views.map(\.context) == ["row", "row"])
    }

    @Test func shortLooksEitherSideOfTheBackgroundAreNeverAddedTogether() {
        let rig = ScanViewRig()
        rig.log.start(tuneID: "t1", origin: .tune)
        rig.clock.advance(2_000)
        rig.log.foreground(false)
        rig.clock.advance(60_000)
        rig.log.foreground(true)
        rig.clock.advance(2_000)
        rig.log.end()
        #expect(rig.recorded.views.isEmpty)
    }

    @Test func anInactiveSpellKeepsTheViewGoing() {
        let rig = ScanViewRig()
        rig.log.start(tuneID: "t1", origin: .tune)
        rig.clock.advance(2_000)
        // Inactive, as under Control Center, is still the foreground.
        rig.log.foreground(true)
        rig.clock.advance(2_000)
        rig.log.end()
        #expect(rig.viewedMs == [4_000])
    }

    @Test func aViewerOpenedInTheBackgroundStartsTimingOnReturn() {
        let rig = ScanViewRig()
        rig.log.foreground(false)
        rig.log.start(tuneID: "t1", origin: .tune)
        rig.clock.advance(60_000)
        rig.log.foreground(true)
        rig.clock.advance(3_000)
        rig.log.end()
        #expect(rig.viewedMs == [3_000])
    }

    @Test func keepsWhereTheViewerWasOpened() {
        let rig = ScanViewRig()
        for origin in [ScanViewOrigin.tune, .row, .list(id: "l1")] {
            rig.log.start(tuneID: "t1", origin: origin)
            rig.clock.advance(3_000)
            rig.log.end()
        }
        #expect(rig.recorded.views.map(\.context) == ["tune", "row", "list"])
        #expect(rig.recorded.views.map(\.listID) == [nil, nil, "l1"])
    }

    @Test func openingAnotherTunesScansEndsThePreviousView() {
        let rig = ScanViewRig()
        rig.log.start(tuneID: "t1", origin: .tune)
        rig.clock.advance(4_000)
        rig.log.start(tuneID: "t2", origin: .row)
        #expect(rig.recorded.views.map(\.tuneID) == ["t1"])
        rig.clock.advance(3_000)
        rig.log.end()
        #expect(rig.recorded.views.map(\.tuneID) == ["t1", "t2"])
        #expect(rig.viewedMs == [4_000, 3_000])
    }

    @Test func anotherStoresWriterDropsTheOpenView() {
        let rig = ScanViewRig()
        rig.log.start(tuneID: "t1", origin: .tune)
        rig.clock.advance(30_000)
        let other = ViewsRecorded()
        rig.log.writer = other.writer
        rig.log.end()
        #expect(rig.recorded.views.isEmpty)
        #expect(other.views.isEmpty)
    }

    @Test func theSameStoresWriterKeepsTheOpenView() {
        let rig = ScanViewRig()
        rig.log.start(tuneID: "t1", origin: .tune)
        rig.clock.advance(30_000)
        rig.log.writer = rig.recorded.writer
        rig.log.end()
        #expect(rig.viewedMs == [30_000])
    }
}

/// The viewer's presentation, and the row actions that ask for it, logging where it was opened.
@MainActor
@Suite struct ScanViewWiringTests {
    private let root = TemporaryRoot()

    @Test func presentingAndDismissingTheViewerLogsOneView() throws {
        let rig = ScanViewRig()
        let request = ScanRequest(tuneID: "t1", startIndex: 2, origin: .list(id: "l1"))
        rig.log.follow(from: nil, to: request)
        rig.clock.advance(6_000)
        rig.log.follow(from: request, to: nil)
        let view = try #require(rig.recorded.views.only)
        #expect(view.tuneID == "t1")
        #expect(view.context == "list")
        #expect(view.listID == "l1")
        #expect(view.viewedMs == 6_000)
    }

    @Test func closingWritesOneViewWhicheverSignalComesFirst() {
        for disappearFirst in [false, true] {
            let rig = ScanViewRig()
            let request = ScanRequest(tuneID: "t1", startIndex: 0, origin: .tune)
            rig.log.follow(from: nil, to: request)
            rig.clock.advance(4_000)
            if disappearFirst {
                rig.log.viewerDisappeared(tuneID: "t1")
                rig.clock.advance(500)
                rig.log.follow(from: request, to: nil)
            } else {
                rig.log.follow(from: request, to: nil)
                rig.clock.advance(500)
                rig.log.viewerDisappeared(tuneID: "t1")
            }
            #expect(rig.viewedMs == [4_000], "disappear first: \(disappearFirst)")
        }
    }

    @Test func anOldViewersDisappearanceLeavesTheNewViewRunning() {
        let rig = ScanViewRig()
        let old = ScanRequest(tuneID: "t1", startIndex: 0, origin: .tune)
        let new = ScanRequest(tuneID: "t2", startIndex: 0, origin: .row)
        rig.log.follow(from: nil, to: old)
        rig.clock.advance(1_000)
        rig.log.follow(from: old, to: new)
        rig.clock.advance(2_000)
        rig.log.viewerDisappeared(tuneID: "t1")
        rig.clock.advance(2_000)
        rig.log.follow(from: new, to: nil)
        #expect(rig.recorded.views.map(\.tuneID) == ["t2"])
        #expect(rig.viewedMs == [4_000])
    }

    @Test func eachContextReachesTheLog() {
        let rig = ScanViewRig()
        for origin in [ScanViewOrigin.tune, .row, .list(id: "l1")] {
            let request = ScanRequest(tuneID: "t1", startIndex: 0, origin: origin)
            rig.log.follow(from: nil, to: request)
            rig.clock.advance(3_000)
            rig.log.follow(from: request, to: nil)
        }
        #expect(rig.recorded.views.map(\.context) == ["tune", "row", "list"])
        #expect(rig.recorded.views.map(\.listID) == [nil, nil, "l1"])
    }

    @Test func eachWindowCountsItsOwnViewer() {
        let first = ScanViewRig()
        let second = ScanViewRig()
        let one = ScanRequest(tuneID: "t1", startIndex: 0, origin: .tune)
        let two = ScanRequest(tuneID: "t2", startIndex: 0, origin: .row)
        first.log.follow(from: nil, to: one)
        second.log.follow(from: nil, to: two)
        first.clock.advance(3_000)
        second.clock.advance(4_000)
        first.log.follow(from: one, to: nil)
        // The second window going to the background ends only its own view.
        second.log.foreground(false)
        second.log.follow(from: two, to: nil)
        #expect(first.recorded.views.map(\.tuneID) == ["t1"])
        #expect(first.viewedMs == [3_000])
        #expect(second.recorded.views.map(\.tuneID) == ["t2"])
        #expect(second.viewedMs == [4_000])
    }

    @Test func theTuneScreenOpensTheViewerFromTheTune() {
        var opened: [(String, Int, ScanViewOrigin)] = []
        let actions = TuneScreenActions(viewScans: { opened.append(($0, $1, $2)) })
        ScansSection.open(tuneID: "t1", index: 2, actions: actions)
        #expect(opened.map(\.0) == ["t1"])
        #expect(opened.map(\.1) == [2])
        #expect(opened.map(\.2) == [.tune])
    }

    @Test func rowActionsOpenTheViewerFromWhereTheyAre() async throws {
        let store = try root.open()
        let tuneID = "t1"
        try await store.write { writer in
            try writer.put(ScanRecord(id: "s1", tuneID: tuneID, width: 600, height: 800))
        }
        let tunes = ScanTunes(store: store)
        try await waitFor { tunes.ids.contains(tuneID) }
        var opened: [(String, Int, ScanViewOrigin)] = []
        let actions = TuneScreenActions(viewScans: { opened.append(($0, $1, $2)) })

        for origin in [ScanViewOrigin.row, .list(id: "l1")] {
            let action = try #require(
                TuneRowActions.scansAction(tuneID: tuneID, tunesWithScans: tunes, origin: origin, actions: actions))
            action()
        }

        #expect(opened.map(\.0) == [tuneID, tuneID])
        #expect(opened.map(\.1) == [0, 0])
        #expect(opened.map(\.2) == [.row, .list(id: "l1")])
    }

    @Test func aViewEndingAfterTheStoreClosesIsDroppedQuietly() async throws {
        let store = try root.open()
        try store.close()
        let reported = Mutex<[String]>([])
        await ScanViewWriter.record(
            ScanView(tuneID: "t1", context: "tune", startedAt: noon, viewedMs: 5_000), into: store,
            report: { error in reported.withLock { $0.append(String(describing: error)) } })
        #expect(reported.withLock { $0 }.isEmpty)
        let reopened = try root.open()
        #expect(try await reopened.read { db in try ScanView.fetchCount(db) } == 0)
    }

    @Test func aRealWriteFailureIsReported() async throws {
        let store = try root.open()
        try await store.write { writer in try writer.db.execute(sql: "DROP TABLE scan_views") }
        let reported = Mutex<[String]>([])
        await ScanViewWriter.record(
            ScanView(tuneID: "t1", context: "tune", startedAt: noon, viewedMs: 5_000), into: store,
            report: { error in reported.withLock { $0.append(String(describing: error)) } })
        #expect(reported.withLock { $0 }.count == 1)
    }

    @Test func theStoreWriterRecordsAViewWithoutCountingAsAnEdit() async throws {
        let store = try root.open()
        let writer = ScanViewWriter.store(store)
        writer.write(ScanView(tuneID: "t1", context: "tune", startedAt: noon, viewedMs: 3_000))
        let stored = { try await store.read { db in try ScanView.fetchAll(db) } }
        if try await !poll({ try await stored().count == 1 }) { Issue.record("The view was never stored") }
        #expect(try await stored().map(\.tuneID) == ["t1"])
        #expect(try await store.pendingEditCount() == 0)
        #expect(try await store.pendingChangeCount() == 1)
    }
}
