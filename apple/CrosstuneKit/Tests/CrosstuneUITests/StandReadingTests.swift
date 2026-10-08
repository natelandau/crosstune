import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct StandReadingTests {
    private let root = TemporaryRoot()

    private func store(withScan: Bool = true) async throws -> CrosstuneStore {
        let store = try await SampleCatalog.makeStore(root: root.url)
        if withScan {
            try await store.write { writer in
                try writer.put(
                    ScanRecord(
                        id: "scan1", createdAt: SampleCatalog.now, tuneID: SampleCatalog.entries[0].tune.id,
                        width: 600, height: 800, state: ScanRecord.ready))
                try ScanFile(scanID: "scan1", fileName: "scan1.jpg", origin: .captured).insert(writer.db)
            }
        }
        return store
    }

    private func recordingItem(_ index: Int) -> PlayerItem {
        let entry = SampleCatalog.recordings[index]
        return PlayerItem(kind: .recording, id: entry.id, title: entry.id, recording: entry.recording)
    }

    @Test func recordingReadsItsTunesScansAndLyrics() async throws {
        let store = try await store()
        let item = recordingItem(0)
        let reading = try await store.read { db in try StandReading.read(db, item: item, listTuneID: nil).reading }
        let found = try #require(reading)
        #expect(found.tuneID == SampleCatalog.entries[0].tune.id)
        #expect(found.scans.count == 1)
        #expect(found.lyrics?.hasPrefix("Grasshopper") == true)
    }

    @Test func linkReadsItsTune() async throws {
        let store = try await store()
        let item = PlayerItem(kind: .link, id: "sample_link_youtube", title: "Link")
        let tuneID = try await store.read { db in try StandReading.tuneID(db, item: item, listTuneID: nil) }
        #expect(tuneID == SampleCatalog.entries[0].tune.id)
        let reading = try await store.read { db in try StandReading.read(db, item: item, listTuneID: nil).reading }
        let found = try #require(reading)
        #expect(found.tuneID == SampleCatalog.entries[0].tune.id)
        #expect(found.scans.map(\.id) == ["scan1"])
        #expect(found.lyrics?.hasPrefix("Grasshopper") == true)
    }

    @Test func aPlayingListWinsOverTheItem() async throws {
        let store = try await store()
        let item = recordingItem(0)
        let listTuneID = SampleCatalog.entries[1].tune.id
        let tuneID = try await store.read { db in try StandReading.tuneID(db, item: item, listTuneID: listTuneID) }
        #expect(tuneID == listTuneID)
    }

    @Test func refiledTakeReadsItsNewTune() async throws {
        let store = try await store()
        let item = recordingItem(0)
        var refiled = try #require(item.recording)
        let newTuneID = SampleCatalog.entries[1].tune.id
        #expect(refiled.tuneID != newTuneID)
        refiled.tuneID = newTuneID
        let stored = refiled
        try await store.write { writer in try writer.put(stored) }
        let tuneID = try await store.read { db in try StandReading.tuneID(db, item: item, listTuneID: nil) }
        #expect(tuneID == newTuneID)
    }

    @Test func unfiledTakeHasNoReading() async throws {
        let store = try await store()
        let index = try #require(SampleCatalog.recordings.firstIndex { $0.id.contains("processing") })
        let item = recordingItem(index)
        let reading = try await store.read { db in try StandReading.read(db, item: item, listTuneID: nil).reading }
        #expect(reading == nil)
    }

    @Test func aTuneWithNothingToReadIsStillTheTuneRead() async throws {
        let store = try await store()
        let listTuneID = SampleCatalog.entries[2].tune.id
        let read = try await store.read { db in try StandReading.read(db, item: nil, listTuneID: listTuneID) }
        #expect(read == StandRead(tuneID: listTuneID, reading: nil))
    }

    @Test func deletedTuneLeavesNoReading() async throws {
        let store = try await store()
        var gone = SampleCatalog.entries[0].tune
        gone.deletedAt = SampleCatalog.now
        let tune = gone
        try await store.write { writer in try writer.put(tune) }
        let item = recordingItem(0)
        let read = try await store.read { db in try StandReading.read(db, item: item, listTuneID: nil) }
        #expect(read == StandRead(tuneID: nil, reading: nil))
    }

    @Test func blankLyricsAreNone() async throws {
        let store = try await store()
        var blank = SampleCatalog.entries[0].tune
        blank.lyrics = "  \n"
        let tune = blank
        try await store.write { writer in try writer.put(tune) }
        let item = recordingItem(0)
        let reading = try await store.read { db in try StandReading.read(db, item: item, listTuneID: nil).reading }
        let found = try #require(reading)
        #expect(found.lyrics == nil)
        #expect(found.scans.count == 1)
    }
}
