import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneCommands

private let song = "https://music.apple.com/us/song/x/1"

private func entry(
    _ tuneID: String, recordings: Int = 0, playable: Bool = true, links: [(String, String)] = []
) -> PlaylistEntry {
    let rows = (0..<recordings).map {
        Recording(id: "\(tuneID)-r\($0)", createdAt: noon, tuneID: tuneID, source: "microphone", addedAt: noon)
    }
    return PlaylistEntry(
        userTune: UserTune(tuneID: tuneID, status: "known"), recordings: rows,
        playable: playable ? Set(rows.map(\.id)) : [],
        links: links.enumerated().map { index, link in
            RecordingLink(
                id: "\(tuneID)-l\(index)", createdAt: noon, tuneID: tuneID, url: link.1, provider: link.0)
        })
}

private func report(
    _ entries: [PlaylistEntry],
    fullTracks: Bool = true, online: Bool = true
) -> PlaylistReport {
    playlistReport(
        entries: entries, playFirst: UserSettings.playFirstRecordings, fullTracks: fullTracks, online: online)
}

@Suite struct PlaylistReportTests {
    @Test func listsPlayableTunesInListOrder() {
        let result = report([
            entry("c", recordings: 1), entry("a", links: [("apple_music", song)]), entry("b", recordings: 2),
        ])
        #expect(result.playable == ["c", "a", "b"])
        #expect(result.total == 3)
    }

    @Test func leavesOutTunesWithNothingAListCanPlay() {
        let result = report([
            entry("n1"), entry("l1", links: [("youtube", "https://example.com/1")]),
            entry("n2"), entry("l2", links: [("spotify", "https://example.com/2")]), entry("ok", recordings: 1),
        ])
        #expect(result.playable == ["ok"])
        #expect(result.total == 5)
    }

    @Test func skipsASongWithoutASubscription() {
        let result = report([entry("s", links: [("apple_music", song)])], fullTracks: false)
        #expect(result.playable.isEmpty)
        #expect(result.total == 1)
    }

    @Test func skipsASongWhileOffline() {
        let result = report([entry("s", links: [("apple_music", song)])], online: false)
        #expect(result.playable.isEmpty)
        #expect(result.total == 1)
    }

    @Test func countsAnEmptyListAsNothingToPlay() {
        #expect(report([]) == PlaylistReport(playable: [], total: 0))
    }

    @Test func leavesOutRecordingsWithNoAudioHere() {
        let result = report([
            entry("r", recordings: 1, playable: false),
            entry("rs", recordings: 1, playable: false, links: [("spotify", "https://example.com/1")]),
            entry("ok", recordings: 1),
        ])
        #expect(result.playable == ["ok"])
        #expect(result.total == 3)
    }
}
