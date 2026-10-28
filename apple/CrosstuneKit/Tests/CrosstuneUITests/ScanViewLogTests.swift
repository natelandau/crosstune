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
        ScanViewWriter { [self] in views.append($0) }
    }
}

/// A scan view log on a test clock, writing to `recorded`.
@MainActor
private struct ScanViewFixture {
    let clock = ActivityClock()
    let recorded = ViewsRecorded()
    let log: ScanViewLog

    init(isForeground: Bool = true) {
        let clock = clock
        log = ScanViewLog(
            writer: recorded.writer, analytics: .noop, isForeground: isForeground, clock: { clock.instant },
            now: { clock.date })
    }

    var viewedMs: [Int64] { recorded.views.map(\.viewedMs) }
}

@MainActor
@Suite struct ScanViewLogTests {
    @Test func aLookUnderThreeSecondsWritesNothing() {
        let fixture = ScanViewFixture()
        fixture.log.start(tuneID: "t1", origin: .tune)
        fixture.clock.advance(2_999)
        fixture.log.end()
        #expect(fixture.recorded.views.isEmpty)
    }

    @Test func threeSecondsWritesAView() throws {
        let fixture = ScanViewFixture()
        fixture.log.start(tuneID: "t1", origin: .tune)
        fixture.clock.advance(3_000)
        fixture.log.end()
        let view = try #require(fixture.recorded.views.only)
        #expect(view.tuneID == "t1")
        #expect(view.context == "tune")
        #expect(view.listID == nil)
        #expect(view.startedAt == noon)
        #expect(view.viewedMs == 3_000)
        #expect(view.createdAt == later(3_000))
        #expect(view.serverSeq == nil)
    }

    @Test func endingTwiceWritesOnce() {
        let fixture = ScanViewFixture()
        fixture.log.start(tuneID: "t1", origin: .tune)
        fixture.clock.advance(5_000)
        fixture.log.end()
        fixture.clock.advance(5_000)
        fixture.log.end()
        #expect(fixture.viewedMs == [5_000])
    }

    @Test func leavingTheForegroundEndsTheViewAndComingBackStartsAnother() {
        let fixture = ScanViewFixture()
        fixture.log.start(tuneID: "t1", origin: .row)
        fixture.clock.advance(5_000)
        fixture.log.foreground(false)
        #expect(fixture.viewedMs == [5_000], "the app may never come back, so the view is written as it leaves")

        // Time in the background counts toward nothing.
        fixture.clock.advance(8 * 3_600_000)
        fixture.log.foreground(true)
        fixture.clock.advance(4_000)
        fixture.log.end()

        #expect(fixture.viewedMs == [5_000, 4_000])
        #expect(fixture.recorded.views.map(\.startedAt) == [noon, later(5_000 + 8 * 3_600_000)])
        #expect(Set(fixture.recorded.views.map(\.id)).count == 2)
        #expect(fixture.recorded.views.map(\.context) == ["row", "row"])
    }

    @Test func shortLooksEitherSideOfTheBackgroundAreNeverAddedTogether() {
        let fixture = ScanViewFixture()
        fixture.log.start(tuneID: "t1", origin: .tune)
        fixture.clock.advance(2_000)
        fixture.log.foreground(false)
        fixture.clock.advance(60_000)
        fixture.log.foreground(true)
        fixture.clock.advance(2_000)
        fixture.log.end()
        #expect(fixture.recorded.views.isEmpty)
    }

    @Test func anInactiveSpellKeepsTheViewGoing() {
        let fixture = ScanViewFixture()
        fixture.log.start(tuneID: "t1", origin: .tune)
        fixture.clock.advance(2_000)
        // Inactive, as under Control Center, is still the foreground.
        fixture.log.foreground(true)
        fixture.clock.advance(2_000)
        fixture.log.end()
        #expect(fixture.viewedMs == [4_000])
    }

    @Test func aViewerOpenedInTheBackgroundStartsTimingOnReturn() {
        let fixture = ScanViewFixture()
        fixture.log.foreground(false)
        fixture.log.start(tuneID: "t1", origin: .tune)
        fixture.clock.advance(60_000)
        fixture.log.foreground(true)
        fixture.clock.advance(3_000)
        fixture.log.end()
        #expect(fixture.viewedMs == [3_000])
    }

    @Test func keepsWhereTheViewerWasOpened() {
        let fixture = ScanViewFixture()
        for origin in [ScanViewOrigin.tune, .row, .list(id: "l1")] {
            fixture.log.start(tuneID: "t1", origin: origin)
            fixture.clock.advance(3_000)
            fixture.log.end()
        }
        #expect(fixture.recorded.views.map(\.context) == ["tune", "row", "list"])
        #expect(fixture.recorded.views.map(\.listID) == [nil, nil, "l1"])
    }

    @Test func openingAnotherTunesScansEndsThePreviousView() {
        let fixture = ScanViewFixture()
        fixture.log.start(tuneID: "t1", origin: .tune)
        fixture.clock.advance(4_000)
        fixture.log.start(tuneID: "t2", origin: .row)
        #expect(fixture.recorded.views.map(\.tuneID) == ["t1"])
        fixture.clock.advance(3_000)
        fixture.log.end()
        #expect(fixture.recorded.views.map(\.tuneID) == ["t1", "t2"])
        #expect(fixture.viewedMs == [4_000, 3_000])
    }

    @Test func aLogMadeInTheBackgroundTimesNothingUntilTheForeground() {
        let fixture = ScanViewFixture(isForeground: false)
        fixture.log.start(tuneID: "t1", origin: .tune)
        fixture.clock.advance(30_000)
        fixture.log.foreground(true)
        fixture.clock.advance(3_000)
        fixture.log.end()
        #expect(fixture.viewedMs == [3_000])
    }
}

/// The viewer's presentation, and the row actions that ask for it, logging where it was opened.
@MainActor
@Suite struct ScanViewWiringTests {
    private let root = TemporaryRoot()

    @Test func presentingAndDismissingTheViewerLogsOneView() throws {
        let fixture = ScanViewFixture()
        let request = ScanRequest(tuneID: "t1", startIndex: 2, origin: .list(id: "l1"))
        fixture.log.follow(from: nil, to: request)
        fixture.clock.advance(6_000)
        fixture.log.follow(from: request, to: nil)
        let view = try #require(fixture.recorded.views.only)
        #expect(view.tuneID == "t1")
        #expect(view.context == "list")
        #expect(view.listID == "l1")
        #expect(view.viewedMs == 6_000)
    }

    @Test func closingWritesOneViewWhicheverSignalComesFirst() {
        for disappearFirst in [false, true] {
            let fixture = ScanViewFixture()
            let request = ScanRequest(tuneID: "t1", startIndex: 0, origin: .tune)
            fixture.log.follow(from: nil, to: request)
            fixture.clock.advance(4_000)
            if disappearFirst {
                fixture.log.viewerDisappeared(tuneID: "t1")
                fixture.clock.advance(500)
                fixture.log.follow(from: request, to: nil)
            } else {
                fixture.log.follow(from: request, to: nil)
                fixture.clock.advance(500)
                fixture.log.viewerDisappeared(tuneID: "t1")
            }
            #expect(fixture.viewedMs == [4_000], "disappear first: \(disappearFirst)")
        }
    }

    @Test func anOldViewersDisappearanceLeavesTheNewViewRunning() {
        let fixture = ScanViewFixture()
        let old = ScanRequest(tuneID: "t1", startIndex: 0, origin: .tune)
        let new = ScanRequest(tuneID: "t2", startIndex: 0, origin: .row)
        fixture.log.follow(from: nil, to: old)
        fixture.clock.advance(1_000)
        fixture.log.follow(from: old, to: new)
        fixture.clock.advance(2_000)
        fixture.log.viewerDisappeared(tuneID: "t1")
        fixture.clock.advance(2_000)
        fixture.log.follow(from: new, to: nil)
        #expect(fixture.recorded.views.map(\.tuneID) == ["t2"])
        #expect(fixture.viewedMs == [4_000])
    }

    @Test func eachContextReachesTheLog() {
        let fixture = ScanViewFixture()
        for origin in [ScanViewOrigin.tune, .row, .list(id: "l1")] {
            let request = ScanRequest(tuneID: "t1", startIndex: 0, origin: origin)
            fixture.log.follow(from: nil, to: request)
            fixture.clock.advance(3_000)
            fixture.log.follow(from: request, to: nil)
        }
        #expect(fixture.recorded.views.map(\.context) == ["tune", "row", "list"])
        #expect(fixture.recorded.views.map(\.listID) == [nil, nil, "l1"])
    }

    @Test func eachWindowCountsItsOwnViewer() {
        let first = ScanViewFixture()
        let second = ScanViewFixture()
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
        try await eventually { tunes.ids.contains(tuneID) }
        var opened: [(String, Int, ScanViewOrigin)] = []
        let actions = TuneScreenActions(viewScans: { opened.append(($0, $1, $2)) })

        for origin in [ScanViewOrigin.row, .list(id: "l1")] {
            let action = try #require(
                TuneRowActions.scansAction(
                    tuneID: tuneID, tunesWithScans: tunes, premium: nil, origin: origin, actions: actions))
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
