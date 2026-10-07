import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import GRDB
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

/// The stats from every row of every table, whole, as the stats were once read: what the
/// narrower reads must still produce.
private func statsFromEveryRow(_ db: Database, settingsRow: String, today: String, zone: TimeZone) throws -> Stats {
    let settings = try UserSettings.fetchOne(db, key: settingsRow).flatMap { $0.deletedAt == nil ? $0 : nil }
    let played = Set(settings?.instruments ?? [])
    return computeStats(
        StatsInput(
            today: today, timeZone: zone.identifier, instruments: Vocabulary.instruments.filter(played.contains),
            tunes: try Tune.fetchAll(db).map {
                StatsInput.Tune(
                    id: $0.id, title: $0.title, key: $0.key, modes: $0.modes, tuneType: $0.tuneType, genre: $0.genre,
                    timeSignature: $0.timeSignature, composer: $0.composer, tunings: .object($0.tunings),
                    deletedAt: $0.deletedAt?.iso)
            },
            userTunes: try UserTune.fetchAll(db).map {
                StatsInput.UserTune(
                    id: $0.id, tuneID: $0.tuneID, status: $0.status, learnedFrom: $0.learnedFrom,
                    learnedOn: $0.learnedOn, archivedAt: $0.archivedAt?.iso, createdAt: $0.createdAt.iso,
                    deletedAt: $0.deletedAt?.iso)
            },
            recordings: try Recording.fetchAll(db).map {
                StatsInput.Recording(
                    id: $0.id, tuneID: $0.tuneID, recordedAt: $0.addedAt.iso, durationMs: $0.durationMs.map(Int.init),
                    trimStartMs: Int($0.trimStartMs), trimEndMs: $0.trimEndMs.map(Int.init),
                    deletedAt: $0.deletedAt?.iso)
            },
            recordingLinks: try RecordingLink.fetchAll(db).map {
                StatsInput.Row(id: $0.id, deletedAt: $0.deletedAt?.iso)
            },
            lists: try TuneList.fetchAll(db).map { StatsInput.Row(id: $0.id, deletedAt: $0.deletedAt?.iso) },
            scans: try ScanRecord.fetchAll(db).map {
                StatsInput.Scan(id: $0.id, tuneID: $0.tuneID, deletedAt: $0.deletedAt?.iso)
            },
            scanViews: try ScanView.fetchAll(db).map { StatsInput.ScanView(id: $0.id, startedAt: $0.startedAt.iso) },
            playEvents: try PlayEvent.fetchAll(db).map {
                StatsInput.PlayEvent(id: $0.id, startedAt: $0.startedAt.iso, listenedMs: Int($0.listenedMs))
            },
            practiceSessions: try PracticeSession.fetchAll(db).map {
                StatsInput.PracticeSession(id: $0.id, startedAt: $0.startedAt.iso, durationMs: Int($0.durationMs))
            },
            statusChanges: try StatusChange.fetchAll(db).map {
                StatsInput.StatusChange(id: $0.id, fromStatus: $0.fromStatus, changedAt: $0.changedAt.iso)
            }))
}

@MainActor
private func loaded(_ store: CrosstuneStore, engine: SyncEngine? = nil) async throws -> StatsModel {
    let model = StatsModel(store: store, engine: engine, now: opened, timeZone: utc)
    try await eventually { model.view != nil }
    return model
}

@MainActor
private func loadedSummary(_ store: CrosstuneStore) async throws -> LiveQuery<StatsSummary?> {
    let summary = StatsSummary.live(store)
    try await eventually { summary.value != nil }
    return summary
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
        let summary = try await loadedSummary(store)
        #expect(summary.value?.line == "2 tunes · 1 list · 1 recording · 9 h 12 m")
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
        let summary = try await loadedSummary(store)
        #expect(summary.value?.line == "2 tunes · 0 lists · 0 recordings · 0 m")
        let model = try await loaded(store)
        #expect(model.stats?.counts.scans == 0)

        try await store.write { writer in
            for (id, tuneID) in [("s1", "t1"), ("s2", "t1"), ("s3", "t2")] {
                try writer.put(ScanRecord(id: id, tuneID: tuneID, width: 600, height: 800))
            }
        }
        try await eventually { model.stats?.counts.scans == 3 }
        try await eventually { summary.value?.scans == 3 }
        #expect(summary.value?.line == "2 tunes · 0 lists · 0 recordings · 3 scans · 0 m")
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
        let open = CatalogTapThrough(catalog: catalog, showRoot: MenuAction { place.showTabRoot(.catalog) })

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
        place.sidebar = .recordings
        place.showSidebarRoot(.catalog)
        #expect(place.sidebar == .catalog)
    }

    @Test func breakdownShowsTopEightThenShowAll() {
        func values(_ n: Int) -> [Stats.Value] { (0..<n).map { Stats.Value(value: "v\($0)", count: n - $0) } }

        let twelve = StatsBreakdown.visible(values(12), expanded: false)
        #expect(twelve.shown.count == 8)
        #expect(twelve.hidden == 4)
        #expect(twelve.shown.map(\.value) == values(8).map(\.value))

        let opened = StatsBreakdown.visible(values(12), expanded: true)
        #expect(opened.shown.count == 12)
        #expect(opened.hidden == 0)

        let eight = StatsBreakdown.visible(values(8), expanded: false)
        #expect(eight.shown.count == 8)
        #expect(eight.hidden == 0)
    }

    @Test func shareBarIsCountOverMaxWithinZeroToOne() {
        #expect(ShareBarRow.share(count: 5, max: 10) == 0.5)
        #expect(ShareBarRow.share(count: 12, max: 10) == 1)
        #expect(ShareBarRow.share(count: -1, max: 10) == 0)
        #expect(ShareBarRow.share(count: 3, max: 0) == 0)
    }

    @Test func tallyLineJoinsListsRecordingsLinksAndScans() {
        func counts(scans: Int) -> Stats.Counts {
            Stats.Counts(
                known: 0, learning: 0, wantToLearn: 0, tunes: 0, archived: 0, lists: 2, recordings: 6, links: 3,
                scans: scans, scanTunes: 1)
        }
        #expect(StatsDocument.tallyLine(counts(scans: 0)) == "Lists 2 · Recordings 6 · Links 3")
        #expect(
            StatsDocument.tallyLine(counts(scans: 4))
                == "Lists 2 · Recordings 6 · Links 3 · \(StatsCopy.scansLine(scans: 4, tunes: 1))")
    }

    @Test func showAllNamesTheTotal() {
        #expect(StatsCopy.showAll(12) == "Show all 12")
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

    @Test func summaryCountsWhatTheStatsCount() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await store.write { writer in
            for (id, status) in [("t1", "known"), ("t2", "learning"), ("t3", "want_to_learn"), ("t4", "someday")] {
                try writer.put(Tune(id: id, createdAt: noon, title: id))
                try writer.put(UserTune(id: "u-\(id)", createdAt: noon, tuneID: id, status: status))
            }
            try writer.put(Tune(id: "archived", createdAt: noon, title: "Archived"))
            try writer.put(
                UserTune(id: "u-archived", createdAt: noon, tuneID: "archived", status: "known", archivedAt: noon))
            try writer.put(Tune(id: "dropped", createdAt: noon, title: "Dropped"))
            try writer.put(
                UserTune(id: "u-dropped", createdAt: noon, deletedAt: noon, tuneID: "dropped", status: "known"))
            try writer.put(Tune(id: "gone", createdAt: noon, deletedAt: noon, title: "Gone"))
            try writer.put(UserTune(id: "u-gone", createdAt: noon, tuneID: "gone", status: "learning"))
            try writer.put(TuneList(name: "Jam"))
            try writer.put(TuneList(deletedAt: noon, name: "Old"))
            try writer.put(
                Recording(tuneID: "t1", source: "recorded", addedAt: noon, durationMs: 60_000, trimStartMs: 5_000))
            try writer.put(
                Recording(tuneID: "t2", source: "recorded", addedAt: noon, durationMs: 90_000, trimEndMs: 30_000))
            try writer.put(
                Recording(tuneID: nil, source: "recorded", addedAt: noon, trimStartMs: 40_000, trimEndMs: 30_000))
            try writer.put(Recording(tuneID: "t3", source: "recorded", addedAt: noon))
            try writer.put(
                Recording(deletedAt: noon, tuneID: "t1", source: "recorded", addedAt: noon, durationMs: 120_000))
            for (index, tuneID) in ["t1", "t1", "t2", "archived", "dropped", "gone"].enumerated() {
                try writer.put(ScanRecord(id: "s\(index)", tuneID: tuneID, width: 600, height: 800))
            }
            try writer.put(ScanRecord(id: "s-deleted", deletedAt: noon, tuneID: "t3", width: 600, height: 800))
        }
        let stats = try #require(try await loaded(store).stats)
        let summary = try #require(try await loadedSummary(store).value ?? nil)
        #expect(
            summary
                == StatsSummary(
                    tunes: stats.counts.tunes, lists: stats.counts.lists, recordings: stats.counts.recordings,
                    scans: stats.counts.scans, recordedMs: stats.recorded.totalMs,
                    byStatus: StatusBar.byStatus(stats.counts)))
        #expect(summary.tunes == 4)
        #expect(summary.scans == 3)
        #expect(summary.recordedMs == 85_000)
    }

    @Test(arguments: ["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/New_York", "Australia/Lord_Howe"])
    func narrowReadsMatchEveryRow(_ zoneID: String) async throws {
        let zone = try #require(TimeZone(identifier: zoneID))
        let today = "2026-10-04"
        let start = "2025-10-05"
        let root = TemporaryRoot()
        let store = try root.open()
        // Instants on and around the heatmap's first and last days, where a zone moves a row
        // across the edge, plus rows long before it and after today.
        let instants = [
            "2024-01-01T12:00:00.000Z", "2025-10-03T23:30:00.000Z", "2025-10-04T10:00:00.000Z",
            "2025-10-04T13:30:00.000Z", "2025-10-05T00:30:00.000Z", "2025-10-05T11:00:00.000Z",
            "2026-03-08T07:30:00.000Z", "2026-10-04T00:15:00.000Z", "2026-10-04T23:45:00.000Z",
            "2026-10-05T09:00:00.000Z", "2026-10-06T12:00:00.000Z", "2027-01-01T00:00:00.000Z",
        ].map { Timestamp(iso: $0)! }
        try await store.write { writer in
            try addTune(writer, "t1", "Sally Ann", key: "D", modes: ["major"], genre: "Old-time", created: instants[1])
            try addTune(writer, "t2", "Kesh", key: "G", modes: ["major"], genre: "Irish", created: instants[4])
            try addTune(writer, "t3", "Cluck Old Hen", created: instants[8])
            for (index, at) in instants.enumerated() {
                try writer.put(
                    Recording(
                        id: "r\(index)", tuneID: index.isMultiple(of: 2) ? "t1" : nil, source: "recorded",
                        addedAt: at, label: "Take \(index)", durationMs: Int64(60_000 * (index + 1)),
                        trimStartMs: 1_000))
                try writer.record(
                    PlayEvent(context: "tune", startedAt: at, listenedMs: Int64(30_000 * (index + 1)), tuneID: "t1"))
                try writer.record(
                    PracticeSession(
                        recordingID: "r\(index)", startedAt: at, durationMs: Int64(90_000 * (index + 1)),
                        speedPercent: 100, pitchCents: 0))
                try writer.record(ScanView(tuneID: "t2", context: "tune", startedAt: at, viewedMs: 4_000))
            }
        }
        try await store.database.write { db in
            for (index, at) in instants.enumerated() {
                try StatusChange(
                    id: "c\(index)", serverSeq: Int64(index + 1), userTuneID: "u-t1",
                    fromStatus: index.isMultiple(of: 3) ? nil : "learning", toStatus: "known", changedAt: at
                ).insert(db)
            }
        }
        let settingsRow = settingsID(clerkUserID: store.userID)
        let (narrow, whole) = try await store.database.read { db in
            (
                try StatsView.fetch(db, settingsRow: settingsRow, today: today, timeZone: zone).stats,
                try statsFromEveryRow(db, settingsRow: settingsRow, today: today, zone: zone)
            )
        }
        #expect(narrow.heatmap.start == start)
        #expect(narrow.heatmap.days.contains { $0.plays > 0 })
        #expect(narrow == whole)
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
        CatalogTapThrough(catalog: catalog, showRoot: MenuAction { place.showTabRoot(.catalog) })(
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
        for (name, width, size) in [
            ("stats-phone", 390.0, DynamicTypeSize.large), ("stats-phone", 390.0, .accessibility3),
            ("stats-wide", 820.0, .large),
        ] {
            snapshot(name, width: width, size: size) {
                StatsDocument(view: view)
            }
        }
    }
}

@Suite("Key grid spreading")
struct KeyGridSpreadTests {
    @Test func spreadsInASplitDetailColumnOnly() {
        #if os(iOS)
            #expect(KeyGridView.spreads(inPadSplit: true))
            #expect(!KeyGridView.spreads(inPadSplit: false))
        #else
            #expect(KeyGridView.spreads(inPadSplit: false))
        #endif
    }
}
