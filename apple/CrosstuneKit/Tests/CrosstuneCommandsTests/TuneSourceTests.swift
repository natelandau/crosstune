import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneCommands

private let tune = "tune-1"
private let song = "https://music.apple.com/us/song/x/1"
private let album = "https://music.apple.com/us/album/x/2"

private func rec(_ id: String, tuneID: String? = tune, deleted: Bool = false) -> Recording {
    Recording(
        id: id, createdAt: noon, deletedAt: deleted ? noon : nil, tuneID: tuneID, source: "microphone",
        addedAt: noon)
}

private func link(_ id: String, _ provider: String, url: String? = nil, tuneID: String = tune, deleted: Bool = false)
    -> RecordingLink
{
    RecordingLink(
        id: id, createdAt: noon, deletedAt: deleted ? noon : nil, tuneID: tuneID,
        url: url ?? (provider == "apple_music" ? song : "https://example.com/\(id)"), provider: provider)
}

private func userTune(recording: String? = nil, link: String? = nil) -> UserTune {
    UserTune(tuneID: tune, status: "known", playRecordingID: recording, playLinkID: link)
}

private func row(
    _ pin: UserTune = userTune(), recordings: [Recording] = [], links: [RecordingLink] = [],
    playFirst: String = UserSettings.playFirstRecordings, recordingsPlay: Bool = true
) -> TuneSource? {
    rowSource(
        userTune: pin, recordings: recordings, links: links, playFirst: playFirst, recordingsPlay: recordingsPlay)
}

private func choice(
    _ pin: UserTune = userTune(), recordings: [Recording] = [], playable: Set<String>? = nil,
    links: [RecordingLink] = [], playFirst: String = UserSettings.playFirstRecordings, fullTracks: Bool = true,
    online: Bool = true, recordingsPlay: Bool = true
) -> TuneSource? {
    playlistSource(
        userTune: pin, recordings: recordings, playable: playable ?? Set(recordings.map(\.id)), links: links,
        playFirst: playFirst, fullTracks: fullTracks, online: online, recordingsPlay: recordingsPlay)
}

@Suite struct RowSourceTests {
    @Test func aValidRecordingPinWinsOverPlayFirst() {
        let r2 = rec("r2")
        let result = row(
            userTune(recording: "r2"), recordings: [rec("r1"), r2], links: [link("l1", "apple_music")],
            playFirst: UserSettings.playFirstAppleMusic)
        #expect(result == .recording(r2))
    }

    @Test func aValidLinkPinWinsOverPlayFirst() {
        let l2 = link("l2", "youtube")
        let result = row(userTune(link: "l2"), recordings: [rec("r1")], links: [link("l1", "apple_music"), l2])
        #expect(result == .link(l2))
    }

    @Test func ignoresAPinToADeletedRow() {
        let r1 = rec("r1")
        #expect(row(userTune(recording: "r2"), recordings: [r1, rec("r2", deleted: true)]) == .recording(r1))
    }

    @Test func ignoresAPinToARowOfAnotherTune() {
        let r1 = rec("r1")
        #expect(row(userTune(recording: "r2"), recordings: [r1, rec("r2", tuneID: "other")]) == .recording(r1))
    }

    @Test func ignoresALinkPinToADeletedLink() {
        let r1 = rec("r1")
        #expect(
            row(
                userTune(link: "l2"), recordings: [r1],
                links: [link("l1", "youtube"), link("l2", "youtube", deleted: true)])
                == .recording(r1))
    }

    @Test func ignoresALinkPinToAnotherTunesLink() {
        let l1 = link("l1", "youtube")
        #expect(row(userTune(link: "l2"), links: [l1, link("l2", "apple_music", tuneID: "other")]) == .link(l1))
    }

    @Test func ignoresAPinToAnIDNotPassedIn() {
        let r1 = rec("r1")
        #expect(row(userTune(recording: "gone", link: "gone"), recordings: [r1]) == .recording(r1))
    }

    @Test(arguments: [UserSettings.playFirstRecordings, UserSettings.playFirstAppleMusic])
    func returnsTheOneSourceWhateverPlayFirstIs(playFirst: String) {
        let r1 = rec("r1")
        let l1 = link("l1", "youtube")
        #expect(row(recordings: [r1], playFirst: playFirst) == .recording(r1))
        #expect(row(links: [l1], playFirst: playFirst) == .link(l1))
    }

    @Test func picksTheFirstRecordingWhenPlayFirstIsRecordings() {
        let r1 = rec("r1")
        #expect(row(recordings: [r1, rec("r2")], links: [link("l1", "apple_music")]) == .recording(r1))
    }

    @Test func picksTheFirstAppleMusicLinkWhenPlayFirstIsAppleMusic() {
        let l2 = link("l2", "apple_music")
        let result = row(
            recordings: [rec("r1")], links: [link("l1", "youtube"), l2, link("l3", "apple_music")],
            playFirst: UserSettings.playFirstAppleMusic)
        #expect(result == .link(l2))
    }

    @Test func fallsBackToTheFirstRecordingWithoutAnAppleMusicLink() {
        let r1 = rec("r1")
        #expect(
            row(recordings: [r1], links: [link("l1", "youtube")], playFirst: UserSettings.playFirstAppleMusic)
                == .recording(r1))
    }

    @Test func picksAnAppleMusicLinkListedAfterAnotherLinkWithoutRecordings() {
        let l2 = link("l2", "apple_music")
        #expect(row(links: [link("l1", "youtube"), l2]) == .link(l2))
    }

    @Test func picksTheFirstLinkWhenThereAreOnlyOtherLinks() {
        let l1 = link("l1", "youtube")
        #expect(row(links: [l1, link("l2", "spotify")], playFirst: UserSettings.playFirstAppleMusic) == .link(l1))
    }

    @Test func neverCountsDeletedRows() {
        let r2 = rec("r2")
        #expect(
            row(
                recordings: [rec("r1", deleted: true), r2],
                links: [link("l1", "apple_music", deleted: true), link("l2", "youtube")],
                playFirst: UserSettings.playFirstAppleMusic) == .recording(r2))
        #expect(row(recordings: [rec("r1", deleted: true)], links: [link("l1", "youtube", deleted: true)]) == nil)
    }

    @Test func returnsNilWithNothingToPlay() {
        #expect(row() == nil)
    }

    @Test func aPinnedRecordingFallsBackToALinkWhileRecordingsCannotPlay() {
        let l1 = link("l1", "youtube")
        let result = row(userTune(recording: "r1"), recordings: [rec("r1")], links: [l1], recordingsPlay: false)
        #expect(result == .link(l1))
    }

    @Test func recordingsAloneGiveNothingWhileRecordingsCannotPlay() {
        #expect(row(recordings: [rec("r1")], recordingsPlay: false) == nil)
        #expect(
            row(recordings: [rec("r1")], links: [link("l1", "apple_music")], recordingsPlay: true)
                == .recording(rec("r1")))
    }
}

@Suite struct PlaylistSourceTests {
    @Test func aRecordingPlaysOffline() {
        let r1 = rec("r1")
        #expect(choice(recordings: [r1], fullTracks: false, online: false) == .recording(r1))
    }

    @Test func anAlbumLinkIsNotPlaylistCapable() {
        let album = link("l1", "apple_music", url: album)
        #expect(choice(links: [album]) == nil)
    }

    @Test func anAppleMusicSongPlaysWhenSubscribedAndOnline() {
        let l1 = link("l1", "apple_music")
        #expect(choice(links: [l1]) == .link(l1))
    }

    @Test func aPinnedSpotifyLinkPassesOverToARecording() {
        let r1 = rec("r1")
        let result = choice(userTune(link: "l2"), recordings: [r1], links: [link("l2", "spotify")])
        #expect(result == .recording(r1))
    }

    @Test func aPinnedSongWithoutFullTracksPassesOverToARecording() {
        let r1 = rec("r1")
        let result = choice(
            userTune(link: "l1"), recordings: [r1], links: [link("l1", "apple_music")], fullTracks: false)
        #expect(result == .recording(r1))
    }

    @Test func aPinnedAppleMusicAlbumPassesOverToASong() {
        let song = link("l2", "apple_music")
        let result = choice(userTune(link: "l1"), links: [link("l1", "apple_music", url: album), song])
        #expect(result == .link(song))
    }

    @Test func aPinnedRecordingWinsOverPlayFirst() {
        let r2 = rec("r2")
        let result = choice(
            userTune(recording: "r2"), recordings: [rec("r1"), r2], links: [link("l1", "apple_music")],
            playFirst: UserSettings.playFirstAppleMusic)
        #expect(result == .recording(r2))
    }

    @Test func playFirstAppleMusicPrefersTheSongOverARecording() {
        let l1 = link("l1", "apple_music")
        #expect(
            choice(recordings: [rec("r1")], links: [l1], playFirst: UserSettings.playFirstAppleMusic)
                == .link(l1))
    }

    @Test func playFirstAppleMusicFallsBackToARecordingOffline() {
        let r1 = rec("r1")
        let result = choice(
            recordings: [r1], links: [link("l1", "apple_music")], playFirst: UserSettings.playFirstAppleMusic,
            online: false)
        #expect(result == .recording(r1))
    }

    @Test func skipsWhenThereIsNoRecordingOrLink() {
        #expect(choice() == nil)
        #expect(
            choice(recordings: [rec("r1", deleted: true)], links: [link("l1", "youtube", deleted: true)])
                == nil)
    }

    @Test func skipsWhenOnlyOtherLinksExist() {
        #expect(choice(links: [link("l1", "youtube"), link("l2", "spotify")]) == nil)
    }

    @Test func skipsASongWithoutASubscription() {
        let links = [link("l1", "apple_music")]
        #expect(choice(links: links, fullTracks: false, online: false) == nil)
        #expect(choice(links: links, fullTracks: false) == nil)
    }

    @Test func skipsASongWhileOffline() {
        #expect(choice(links: [link("l1", "apple_music")], online: false) == nil)
    }

    @Test func aPinnedRecordingWithNoAudioHerePassesOverToASong() {
        let song = link("l1", "apple_music")
        let result = choice(userTune(recording: "r1"), recordings: [rec("r1")], playable: [], links: [song])
        #expect(result == .link(song))
    }

    @Test func skipsRecordingsWithNoAudioHereWhenTheyAreTheOnlySource() {
        #expect(choice(recordings: [rec("r1")], playable: []) == nil)
    }

    @Test func skipsRecordingsWithNoAudioHereBesideALinkThatCannotPlay() {
        let result = choice(recordings: [rec("r1")], playable: [], links: [link("l1", "spotify")])
        #expect(result == nil)
    }

    @Test func aSongThatCannotPlayBesideRecordingsWithNoAudioHereSkips() {
        let links = [link("l1", "apple_music")]
        #expect(
            choice(recordings: [rec("r1")], playable: [], links: links, fullTracks: false) == nil)
        #expect(choice(recordings: [rec("r1")], playable: [], links: links, online: false) == nil)
    }

    @Test func aPinnedRecordingFallsBackToASongWhileRecordingsCannotPlay() {
        let song = link("l1", "apple_music")
        let result = choice(userTune(recording: "r1"), recordings: [rec("r1")], links: [song], recordingsPlay: false)
        #expect(result == .link(song))
    }

    @Test func skipsATuneWithOnlyRecordingsWhileRecordingsCannotPlay() {
        #expect(choice(recordings: [rec("r1")], recordingsPlay: false) == nil)
        #expect(
            choice(recordings: [rec("r1")], links: [link("l1", "spotify")], recordingsPlay: false) == nil)
        #expect(choice(recordings: [rec("r1")], recordingsPlay: true) == .recording(rec("r1")))
    }

    @Test func aDeletedRecordingWithNoAudioHereSkips() {
        #expect(choice(recordings: [rec("r1", deleted: true)], playable: []) == nil)
    }
}
