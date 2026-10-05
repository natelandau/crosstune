import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import SwiftUI
import Synchronization
import Testing

@testable import CrosstuneSync
@testable import CrosstuneUI

#if os(macOS)
    import AppKit
#endif

@MainActor
private func eventually(_ condition: @MainActor () async throws -> Bool) async throws {
    if try await poll({ try await condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}

// Noon UTC keeps every fixture instant on the same local date in any zone a runner uses.
private let opened = Timestamp(iso: "2026-10-04T12:00:00.000Z")!.date
private let utc = TimeZone(identifier: "UTC")!

private final class Counter: Sendable {
    let value = Mutex(0)
}

/// A server whose events pull always fails, as offline or mid-outage, counting each try.
private struct FailingEventsAPI: SyncAPI {
    let eventCalls = Counter()

    func push(_ changes: [Change]) async throws -> [PushResult] { [] }
    func pull(since: Int64) async throws -> PullPage { PullPage(rows: [], nextSince: since, hasMore: false) }
    func events(since: Int64) async throws -> EventsPage {
        eventCalls.value.withLock { $0 += 1 }
        throw URLError(.notConnectedToInternet)
    }
    func storage() async throws -> StorageFigures { StorageFigures(usedBytes: 0, quotaBytes: 0, maxFileBytes: 0) }
    func resolveLink(url: String) async throws -> ResolvedLink { throw URLError(.badURL) }
    func searchRecordings(q: String, providers: [String], country: String) async throws -> SearchResponse {
        throw URLError(.badURL)
    }
    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
        throw URLError(.badURL)
    }
    func uploadFinished(recordingID: String) async throws { throw URLError(.badURL) }
    func downloadURL(recordingID: String) async throws -> DownloadURL { throw URLError(.badURL) }
    func peaksURL(recordingID: String) async throws -> PeaksURL { throw URLError(.badURL) }
    func scanUploadSlot(scanID: String, bytes: Int64) async throws -> SignedURL { throw URLError(.badURL) }
    func scanUploaded(scanID: String) async throws { throw URLError(.badURL) }
    func scanDownload(scanID: String) async throws -> SignedURL { throw URLError(.badURL) }
    func retryRecording(recordingID: String) async throws { throw URLError(.badURL) }
    func putObject(_ url: URL, file: URL, contentType: String) async throws { throw URLError(.badURL) }
    func getObject(_ url: URL, to destination: URL) async throws { throw URLError(.badURL) }
}

private func addTune(
    _ writer: StoreWriter, _ id: String, _ title: String, key: String? = nil, modes: [String] = [],
    genre: String? = nil, composer: String? = nil, learnedFrom: String? = nil, created: Timestamp = noon
) throws {
    try writer.put(
        Tune(id: id, createdAt: created, title: title, composer: composer, genre: genre, key: key, modes: modes))
    try writer.put(
        UserTune(id: "u-\(id)", createdAt: created, tuneID: id, status: "known", learnedFrom: learnedFrom))
}

@MainActor
private func loaded(_ store: CrosstuneStore, engine: SyncEngine? = nil, history: Bool = true) async throws
    -> StatsModel
{
    let model = StatsModel(store: store, engine: engine, now: opened, timeZone: utc, history: history)
    try await eventually { model.view != nil }
    return model
}

@MainActor
@Suite struct StatsTests {
    @Test func summaryRowShowsCountsAndTime() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            try addTune(writer, "t1", "Sally Ann")
            try addTune(writer, "t2", "Cluck Old Hen")
            try writer.put(TuneList(name: "Jam"))
            // Nine hours and twelve minutes.
            try writer.put(
                Recording(tuneID: "t1", source: "recorded", addedAt: noon, durationMs: 33_120_000))
        }
        let model = try await loaded(store, history: false)
        #expect(model.summaryLine == "2 tunes · 1 list · 1 recording · 9 h 12 m")
        #expect(
            StatsCopy.summaryLine(tunes: 1, lists: 0, recordings: 2, scans: 0, ms: 0)
                == "1 tune · 0 lists · 2 recordings · 0 m")
        #expect(
            StatsCopy.summaryLine(tunes: 1_212, lists: 1, recordings: 1, scans: 0, ms: 60_000).hasPrefix("1,212 tunes"))
    }

    @Test func scansShowInTheSummaryAndCountsOnlyWhenThereAreAny() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            try addTune(writer, "t1", "Sally Ann")
            try addTune(writer, "t2", "Cluck Old Hen")
        }
        let model = try await loaded(store, history: false)
        #expect(model.summaryLine == "2 tunes · 0 lists · 0 recordings · 0 m")
        #expect(model.stats?.counts.scans == 0)

        try await store.write { writer in
            for (id, tuneID) in [("s1", "t1"), ("s2", "t1"), ("s3", "t2")] {
                try writer.put(ScanRecord(id: id, tuneID: tuneID, width: 600, height: 800))
            }
        }
        try await eventually { model.stats?.counts.scans == 3 }
        #expect(model.summaryLine == "2 tunes · 0 lists · 0 recordings · 3 scans · 0 m")
        let counts = try #require(model.stats?.counts)
        #expect(StatsCopy.scansLine(scans: counts.scans, tunes: counts.scanTunes) == "3 scans across 2 tunes")
    }

    @Test func aScanViewOnTheDeviceMarksItsDay() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            try addTune(writer, "t1", "Sally Ann")
            try writer.record(ScanView(tuneID: "t1", context: "tune", startedAt: noon, viewedMs: 4_000))
        }
        let model = try await loaded(store)
        let day = try #require(model.stats?.heatmap.days.first { $0.date == "2026-09-25" })
        #expect(day.scanViews == 1)
        #expect(StatsCopy.dayDetail(day, today: "2026-10-04").contains("1 scan viewed"))
    }

    @Test func emptyCatalogShowsCountsAndRecordedOnly() async throws {
        let root = TemporaryRoot()
        let model = try await loaded(try root.open())
        let view = try #require(model.view)
        #expect(StatsBlock.blocks(view.stats).map(\.header) == [StatsCopy.countsHeader, StatsCopy.recordedHeader])
        #expect(StatsCopy.recordedLine(recordings: view.stats.recorded.count, ms: 0) == "0 recordings · 0 m")
    }

    @Test func unusedAttributeHasNoSection() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { try addTune($0, "t1", "Sally Ann", key: "D", modes: ["major"]) }
        let model = try await loaded(store)
        let headers = StatsBlock.blocks(try #require(model.view).stats).map(\.header)
        #expect(
            headers == [
                StatsCopy.countsHeader, StatsCopy.recordedHeader, StatsCopy.monthsHeader, CatalogFacet.key.label,
            ])
        #expect(!headers.contains(CatalogFacet.tuneType.label))
        #expect(!headers.contains(CatalogFacet.genre.label))
    }

    @Test func composerAndLearnedFromRowsCarryTheirFacets() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write {
            try addTune($0, "t1", "Sally Ann", composer: "Ed Haley", learnedFrom: "Kevin")
        }
        let model = try await loaded(store)
        let blocks = StatsBlock.blocks(try #require(model.view).stats)
        let facets = blocks.compactMap { block -> (String, CatalogFacet?)? in
            if case .values(let header, _, let facet) = block { (header, facet) } else { nil }
        }
        #expect(facets.map(\.0) == [CatalogFacet.composer.label, CatalogFacet.learnedFrom.label])
        #expect(facets.map(\.1) == [.composer, .learnedFrom])
    }

    @Test func statsRenderOfflineFromLocalRows() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { try addTune($0, "t1", "Sally Ann") }
        let api = FailingEventsAPI()
        let engine = SyncEngine(store: store, api: api, isOffline: { false }, sleep: { _ in })
        let model = try await loaded(store, engine: engine)
        await model.appeared()?.value
        #expect(model.appeared() == nil)
        await engine.stopAndWait()
        #expect(api.eventCalls.value.withLock { $0 } == 1)
        #expect(model.view?.stats.counts.tunes == 1)
    }

    @Test func keyValueSetsCatalogFilter() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            try addTune(writer, "t1", "Sally Ann", key: "D", modes: ["major"], genre: "Irish")
            try addTune(writer, "t2", "Kesh", key: "E", modes: ["dorian"])
            try writer.setMeta(
                .catalogFilters,
                to: CatalogFilters(status: "known", facets: [.genre: "Irish"], archived: true, unheard: true).stored)
        }
        let catalog = CatalogModel(store: store)
        try await eventually { catalog.results?.filters.facets[.genre] == "Irish" }
        catalog.query = "reel"
        let place = ShellPlace()
        place.tab = .settings
        place.tabTunes[.catalog] = "t2"
        let open = CatalogTapThrough(catalog: catalog, showRoot: MenuAction { place.showRoot(.catalog, inTabs: true) })

        open(StatsLink.key("D")!)
        #expect(catalog.query.isEmpty)
        #expect(place.tab == .catalog)
        #expect(place.tabTunes[.catalog] == nil)
        try await eventually { !catalog.isSavingFilters }
        var stored = CatalogFilters(stored: try await store.meta(.catalogFilters, as: JSONValue.self))
        #expect(stored == CatalogFilters(facets: [.key: "D"]))

        open(StatsLink.keyMode(key: "E", mode: "dorian")!)
        try await eventually { !catalog.isSavingFilters }
        stored = CatalogFilters(stored: try await store.meta(.catalogFilters, as: JSONValue.self))
        #expect(stored == CatalogFilters(facets: [.key: "E", .mode: "dorian"]))
    }

    @Test func splitViewOpensTheCatalogRow() {
        let place = ShellPlace()
        place.sidebar = .settings
        place.showRoot(.catalog, inTabs: false)
        #expect(place.sidebar == .catalog)
    }

    @Test func dayDetailNamesOnlyNonzeroParts() {
        let day = Stats.Day(
            date: "2026-03-14", musicMs: 1, plays: 12, practiceSessions: 2, scanViews: 0, tunesAdded: 3,
            recordings: 0, statusChanges: 0, level: 2)
        #expect(
            StatsCopy.dayDetail(day, today: "2026-10-04") == "Mar 14 · 12 plays · 2 practice sessions · 3 tunes added")
        let single = Stats.Day(
            date: "2025-03-14", musicMs: 0, plays: 1, practiceSessions: 0, scanViews: 0, tunesAdded: 0,
            recordings: 1, statusChanges: 1, level: 1)
        #expect(
            StatsCopy.dayDetail(single, today: "2026-10-04") == "Mar 14, 2025 · 1 play · 1 recording · 1 status change")
    }

    // Literal on purpose: these pin the words to web/src/features/stats/copy.ts.
    @Test func scanLinesReadAsTheWebsDo() {
        #expect(StatsCopy.scansLine(scans: 86, tunes: 41) == "86 scans across 41 tunes")
        #expect(StatsCopy.scansLine(scans: 1, tunes: 1) == "1 scan across 1 tune")
        #expect(
            StatsCopy.summaryLine(tunes: 212, lists: 14, recordings: 37, scans: 86, ms: 33_120_000)
                == "212 tunes · 14 lists · 37 recordings · 86 scans · 9 h 12 m")
        #expect(
            StatsCopy.summaryLine(tunes: 1, lists: 1, recordings: 1, scans: 1, ms: 0)
                == "1 tune · 1 list · 1 recording · 1 scan · 0 m")
        let day = Stats.Day(
            date: "2026-03-14", musicMs: 0, plays: 12, practiceSessions: 2, scanViews: 3, tunesAdded: 3,
            recordings: 0, statusChanges: 0, level: 2)
        #expect(
            StatsCopy.dayDetail(day, today: "2026-10-04")
                == "Mar 14 · 12 plays · 2 practice sessions · 3 scans viewed · 3 tunes added")
        var one = day
        one.plays = 0
        one.practiceSessions = 0
        one.scanViews = 1
        one.tunesAdded = 0
        #expect(StatsCopy.dayDetail(one, today: "2026-10-04") == "Mar 14 · 1 scan viewed")
    }

    @Test func linesReadAsTheWebsDo() {
        #expect(
            StatsCopy.onThisDayLine(.init(kind: .tuneAdded, id: "t", years: 1), title: "Sally Ann")
                == "One year ago you added Sally Ann")
        #expect(
            StatsCopy.onThisDayLine(.init(kind: .learned, id: "t", years: 2), title: nil)
                == "You learned a tune 2 years ago")
        #expect(
            StatsCopy.onThisDayLine(.init(kind: .recording, id: "r", years: 1), title: "Cluck Old Hen")
                == "One year ago you added a recording of Cluck Old Hen")
        #expect(
            StatsCopy.onThisDayLine(.init(kind: .recording, id: "r", years: 3), title: "Cluck Old Hen")
                == "3 years ago you added a recording of Cluck Old Hen")
        #expect(
            StatsCopy.onThisDayLine(.init(kind: .recording, id: "r", years: 1), title: nil)
                == "One year ago you added a recording")
        #expect(
            StatsCopy.onThisDayLine(.init(kind: .firstTune, id: "t", years: 1), title: "Kesh")
                == "Your first tune, Kesh, one year ago")
        #expect(
            StatsCopy.rarityLine(.init(attribute: .keyMode, value: "E dorian", tuneID: "t"))
                == "Your only tune in E dorian")
        #expect(
            StatsCopy.rarityLine(.init(attribute: .tuning, value: "AEAE", instrument: "violin", tuneID: "t"))
                == "Your only violin tune in AEAE")
        #expect(StatsCopy.rarityLine(.init(attribute: .tuneType, value: "reel", tuneID: "t")) == "Your only reel")
        #expect(StatsCopy.monthBarLabel("2026-10", 1_200) == "Oct 2026: 1,200")
        #expect(StatsCopy.archivedLine(1) == "1 archived tune, not counted above")
    }

    @Test func labelsTheWeekHoldingEachFirst() {
        func days(from start: String, count: Int) -> [Stats.Day] {
            let first = Timestamp(iso: "\(start)T12:00:00.000Z")!.date
            return (0..<count).map { offset in
                let date = first.addingTimeInterval(Double(offset) * 86_400)
                return Stats.Day(
                    date: localDate(Timestamp(date).iso, in: utc)!, musicMs: 0, plays: 0, practiceSessions: 0,
                    scanViews: 0, tunesAdded: 0, recordings: 0, statusChanges: 0, level: 0)
            }
        }
        #expect(StatsCopy.weekMonthLabels(days(from: "2026-08-30", count: 35)) == ["Sep", nil, nil, nil, "Oct"])
        #expect(StatsCopy.weekMonthLabels(days(from: "2026-09-06", count: 26)) == [nil, nil, nil, "Oct"])
    }

    @Test func everyHeatStepStandsOutFromEverySurface() {
        func luminance(_ rgb: UInt32) -> Double {
            func channel(_ shift: UInt32) -> Double {
                let c = Double(rgb >> shift & 0xff) / 255
                return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
        }
        func contrast(_ a: UInt32, _ b: UInt32) -> Double {
            let (x, y) = (luminance(a), luminance(b))
            return (max(x, y) + 0.05) / (min(x, y) + 0.05)
        }
        // Grouped rows and pages on iOS and macOS, with a margin past each.
        let lightSurfaces: [UInt32] = [0xffffff, 0xf5f5f5, 0xf2f2f7, 0xececec, 0xe5e5ea]
        let darkSurfaces: [UInt32] = [0x000000, 0x1c1c1e, 0x1e1e1e, 0x2c2c2e, 0x323232, 0x3a3a3c]
        for step in HeatColor.light {
            for surface in lightSurfaces { #expect(contrast(step, surface) >= 3) }
        }
        for step in HeatColor.dark {
            for surface in darkSurfaces { #expect(contrast(step, surface) >= 3) }
        }
        #expect(HeatColor.hex(1, dark: false) == "#707c93")
        #expect(HeatColor.hex(4, dark: true) == "#e4e8ef")
    }

    #if os(macOS)
        /// The Mac draws the same tested ramp as iOS, not a tint at reduced opacity, whose
        /// lightest step would vanish into the row.
        @Test func theMacFillsDaysFromTheRamp() {
            for level in 1...4 {
                for (scheme, dark) in [(ColorScheme.light, false), (.dark, true)] {
                    let color = NSColor(HeatColor.color(level, scheme: scheme)).usingColorSpace(.sRGB)
                    let rgb = color.map { color in
                        [color.redComponent, color.greenComponent, color.blueComponent]
                            .map { UInt32(($0 * 255).rounded()) }
                            .reduce(0) { $0 << 8 | $1 }
                    }
                    #expect(rgb.map { String(format: "#%06x", $0) } == HeatColor.hex(level, dark: dark))
                    #expect(color?.alphaComponent == 1)
                }
            }
        }
    #endif

    @Test func summaryNeverPullsHistory() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let api = FailingEventsAPI()
        let engine = SyncEngine(store: store, api: api, isOffline: { false }, sleep: { _ in })
        let summary = try await loaded(store, engine: engine, history: false)
        #expect(summary.appeared() == nil)
        let screen = try await loaded(store, engine: engine)
        await screen.appeared()?.value
        #expect(screen.appeared() == nil)
        // The screen's one pull is the only one the server saw.
        #expect(api.eventCalls.value.withLock { $0 } == 1)
        await engine.stopAndWait()
    }

    @Test func aValueTheCatalogWouldReadAsAnyOrNoKeyOnlyReads() {
        #expect(StatsLink.value("Irish", facet: .genre) == [.genre: "Irish"])
        #expect(StatsLink.value("All", facet: .genre) == nil)
        #expect(StatsLink.value("None", facet: .genre) == [.genre: "None"])
        #expect(StatsLink.key("None") == nil)
        #expect(StatsLink.keyMode(key: "D", mode: "ALL") == nil)
        #expect(StatsLink.keyMode(key: "D", mode: "major") == [.key: "D", .mode: "major"])
    }

    @Test func aCatalogTapLandsBeforeTheCatalogLoads() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { try addTune($0, "t1", "Sally Ann", key: "D", modes: ["major"]) }
        let catalog = CatalogModel(store: store)
        let place = ShellPlace()
        CatalogTapThrough(catalog: catalog, showRoot: MenuAction { place.showRoot(.catalog, inTabs: true) })(
            StatsLink.key("D")!)
        try await eventually {
            let stored = try await store.meta(.catalogFilters, as: JSONValue.self)
            return CatalogFilters(stored: stored) == CatalogFilters(facets: [.key: "D"])
        }
        try await eventually { catalog.results?.filters == CatalogFilters(facets: [.key: "D"]) }
    }

    @Test func snapshotsTheBlocks() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            let keys = [
                ("D", "major"), ("G", "major"), ("A", "mixolydian"), ("E", "dorian"), ("D", "minor"),
                ("G", "modal"), ("C", "other"),
            ]
            for (index, (key, mode)) in keys.enumerated() {
                let created = Timestamp(milliseconds: noon.milliseconds - Int64(index) * 40 * 86_400_000)
                try addTune(
                    writer, "t\(index)", "Tune \(index)", key: key, modes: [mode], genre: "Old-time", created: created)
            }
            for day in 0..<40 {
                let at = Timestamp(milliseconds: noon.milliseconds - Int64(day * 3) * 86_400_000)
                try writer.put(
                    Recording(
                        tuneID: "t\(day % 5)", source: "recorded", addedAt: at,
                        durationMs: Int64(60_000 * (day % 7 + 1))))
            }
        }
        let model = try await loaded(store)
        let view = try #require(model.view)
        for (name, width) in [("stats-phone", 390.0), ("stats-wide", 820.0)] {
            snapshot(name, width: width) {
                VStack(alignment: .leading, spacing: 24) {
                    MonthBarsView(months: view.stats.months)
                    HeatmapView(heatmap: view.stats.heatmap, today: view.today)
                    KeyGridView(rows: view.stats.breakdowns.key, open: nil, scrolls: false)
                }
            }
        }
    }
}
