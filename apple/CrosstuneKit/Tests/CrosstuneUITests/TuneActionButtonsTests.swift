import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@MainActor @Suite struct TuneActionButtonsTests {
    private let tune = Tune(createdAt: noon, title: "Test")

    private var userTune: UserTune { UserTune(createdAt: noon, tuneID: tune.id, status: "learning") }

    private func recording(_ id: String = "r1", state: String = "ready", held: Bool = false) -> TuneRecording {
        TuneRecording(
            recording: Recording(id: id, tuneID: tune.id, source: "microphone", state: state),
            file: held ? RecordingFile(id: id, localState: .downloaded, fileName: "\(id).m4a") : nil)
    }

    private func video(_ id: String = "l1") -> RecordingLink {
        RecordingLink(
            id: id, tuneID: tune.id, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", provider: "youtube",
            providerRef: "dQw4w9WgXcQ")
    }

    private func page(_ id: String = "l2") -> RecordingLink {
        RecordingLink(id: id, tuneID: tune.id, url: "https://example.com/tune", provider: "other")
    }

    private func detail(
        recordings: [TuneRecording] = [], links: [RecordingLink] = [], userTune: UserTune? = nil,
        lyrics: String? = nil
    ) -> TuneDetail {
        var tune = tune
        tune.lyrics = lyrics
        return TuneDetail(tune: tune, userTune: userTune ?? self.userTune, links: links, recordings: recordings)
    }

    private func buttons(
        _ detail: TuneDetail, recordingsPlay: Bool = true, planRead: Bool = true, showsLyrics: Bool = true,
        capturing: Bool = false, online: Bool = true, loaded: Set<String> = []
    ) -> TuneActionButtons.Layout {
        TuneActionButtons.buttons(
            detail: detail, playFirst: UserSettings.playFirstRecordings, recordingsPlay: recordingsPlay,
            planRead: planRead, showsLyrics: showsLyrics, capturing: capturing, online: online,
            holds: { loaded.contains($1) })
    }

    private func names(_ layout: TuneActionButtons.Layout) -> [String] {
        guard case .buttons(let buttons) = layout else { return ["holding"] }
        return buttons.map {
            switch $0 {
            case .play(let primary): primary.label
            case .practice: "Practice"
            case .lyrics: "Lyrics"
            }
        }
    }

    @Test func showsNoRowForATuneWithNothingToPlayOrRead() {
        #expect(buttons(detail()) == .buttons([]))
    }

    @Test func offersPlayForALinkOnly() {
        #expect(names(buttons(detail(links: [video()]))) == ["Play"])
    }

    @Test func offersPlayAndPracticeForARecordingOnTheDevice() {
        #expect(names(buttons(detail(recordings: [recording(held: true)]))) == ["Play", "Practice"])
    }

    @Test func offersLyricsLastWhenTheTuneHasThem() {
        let words = "Grasshopper sitting on a sweet potato vine"
        #expect(names(buttons(detail(lyrics: words))) == ["Lyrics"])
        #expect(
            names(buttons(detail(recordings: [recording(held: true)], lyrics: words)))
                == ["Play", "Practice", "Lyrics"])
    }

    @Test func leavesLyricsOutWithBlankLyricsOrNoWayToShowThem() {
        #expect(buttons(detail(lyrics: " \n\t ")) == .buttons([]))
        #expect(buttons(detail(lyrics: "Grasshopper sitting"), showsLyrics: false) == .buttons([]))
    }

    @Test func showsNoRowOnAFreePlanWithOnlyRecordings() {
        #expect(buttons(detail(recordings: [recording(held: true)]), recordingsPlay: false) == .buttons([]))
    }

    @Test func keepsALinkOnAFreePlanWithoutPractice() {
        let layout = buttons(detail(recordings: [recording(held: true)], links: [video()]), recordingsPlay: false)
        #expect(names(layout) == ["Play"])
    }

    @Test func dropsPlayAndPracticeWhileARecordingIsUnderWay() {
        #expect(buttons(detail(recordings: [recording(held: true)]), capturing: true) == .buttons([]))
        #expect(names(buttons(detail(links: [page()]), capturing: true)) == ["Open"])
    }

    @Test func offersPlayForARecordingOnlyOnTheServer() {
        #expect(names(buttons(detail(recordings: [recording()]))) == ["Play"])
        #expect(
            names(buttons(detail(recordings: [recording(), recording("r2", held: true)]))) == ["Play", "Practice"])
    }

    @Test func passesOverARecordingWithNoAudioAnywhereToTheNextSource() {
        let pinned = UserTune(createdAt: noon, tuneID: tune.id, status: "learning", playRecordingID: "r1")
        let layout = buttons(detail(recordings: [recording(state: "uploaded")], links: [video()], userTune: pinned))
        #expect(primaryItemID(layout) == "l1")
        #expect(buttons(detail(recordings: [recording(state: "failed")])) == .buttons([]))
    }

    @Test func passesOverARecordingOnlyOnTheServerWhileOffline() {
        #expect(primaryItemID(buttons(detail(recordings: [recording()], links: [video()]), online: false)) == "l1")
        #expect(buttons(detail(recordings: [recording()]), online: false) == .buttons([]))
    }

    @Test func keepsStopForTheLoadedRecordingThoughItCanNoLongerPlay() {
        let layout = buttons(detail(recordings: [recording(state: "uploaded")], links: [video()]), loaded: ["r1"])
        #expect(names(layout).first == "Stop")
        #expect(primaryItemID(layout) == "r1")
    }

    @Test func holdsTheRowWhileThePlanIsUnread() {
        #expect(buttons(detail(links: [video()]), planRead: false) == .holding)
        #expect(buttons(detail(recordings: [recording()]), planRead: false) == .holding)
        #expect(buttons(detail(lyrics: "Grasshopper sitting"), planRead: false) == .holding)
    }

    @Test func holdsNoRowForATuneNoButtonCouldActOn() {
        #expect(buttons(detail(), planRead: false) == .buttons([]))
        #expect(buttons(detail(lyrics: "Grasshopper sitting"), planRead: false, showsLyrics: false) == .buttons([]))
    }

    @Test func pressingPlayStopsTheItemThePlayerHoldsElsePlaysIt() {
        let item = PlayerItem.recording(Recording(id: "r1", tuneID: tune.id, source: "microphone"), tuneTitle: "Test")
        #expect(TuneActionButtons.press(.play(item), links: []) { _, _ in false } == .play(item))
        #expect(TuneActionButtons.press(.play(item), links: []) { $0 == item.kind && $1 == item.id } == .stop)
    }

    @Test func pressingOpenReportsTheLinkItOpens() throws {
        let link = page()
        let url = try #require(LinkText.outboundURL(link.url))
        #expect(
            TuneActionButtons.press(.open(url, linkTitle: "Tune"), links: [video(), link]) { _, _ in false }
                == .open(url, link: link))
        let elsewhere = try #require(URL(string: "https://example.org/other"))
        #expect(
            TuneActionButtons.press(.open(elsewhere, linkTitle: "Other"), links: [link]) { _, _ in false }
                == .open(elsewhere, link: nil))
    }

    @Test func pressingAButtonWithNothingToDoDoesNothing() {
        #expect(TuneActionButtons.press(.downloading, links: []) { _, _ in false } == .nothing)
        #expect(TuneActionButtons.press(.inert, links: []) { _, _ in false } == .nothing)
    }

    @Test func namesThePrimaryForWhatAPressDoes() {
        #expect(names(buttons(detail(recordings: [recording(held: true)]))).first == "Play")
        #expect(names(buttons(detail(links: [page()]))).first == "Open")
        #expect(names(buttons(detail(recordings: [recording(held: true)]), loaded: ["r1"])).first == "Stop")
        #expect(names(buttons(detail(links: [video()]), loaded: ["l1"])).first == "Stop")
    }

    @Test func offersPlayWhileTheRecordingDownloads() {
        let downloading = TuneRecording(
            recording: Recording(id: "r1", tuneID: tune.id, source: "microphone", state: "ready"),
            file: RecordingFile(id: "r1", localState: .downloading))
        #expect(names(buttons(detail(recordings: [downloading]))) == ["Play"])
    }

    @Test func offersPracticeOnlyForARecordingOnTheDevice() {
        #expect(names(buttons(detail(recordings: [recording(state: "pending_upload")]))) == [])
        let held = detail(recordings: [recording(state: "pending_upload", held: true)])
        #expect(names(buttons(held)).contains("Practice"))
    }

    @Test func practicesThePinnedRecordingOnTheDeviceElseTheFirstOnTheDevice() {
        let first = recording("a")
        let second = recording("b", held: true)
        let third = recording("c", held: true)
        #expect(practiceID(buttons(detail(recordings: [first, second, third]))) == "b")
        let pinned = UserTune(createdAt: noon, tuneID: tune.id, status: "learning", playRecordingID: "c")
        #expect(practiceID(buttons(detail(recordings: [first, second, third], userTune: pinned))) == "c")
        let pinnedAway = UserTune(createdAt: noon, tuneID: tune.id, status: "learning", playRecordingID: "a")
        #expect(practiceID(buttons(detail(recordings: [first, second, third], userTune: pinnedAway))) == "b")
    }

    private func primaryItemID(_ layout: TuneActionButtons.Layout) -> String? {
        guard case .buttons(let buttons) = layout else { return nil }
        for case .play(let primary) in buttons {
            if case .play(let item) = primary.action { return item.id }
        }
        return nil
    }

    private func practiceID(_ layout: TuneActionButtons.Layout) -> String? {
        guard case .buttons(let buttons) = layout else { return nil }
        for case .practice(let item) in buttons { return item.id }
        return nil
    }
}
