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
        recordedAt: noon)
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
    playFirst: String = UserSettings.playFirstRecordings
) -> TuneSource? {
    rowSource(userTune: pin, recordings: recordings, links: links, playFirst: playFirst)
}

private func choice(
    _ pin: UserTune = userTune(), recordings: [Recording] = [], playable: Set<String>? = nil,
    links: [RecordingLink] = [], playFirst: String = UserSettings.playFirstRecordings, fullTracks: Bool = true,
    online: Bool = true
) -> PlaylistChoice {
    playlistSource(
        userTune: pin, recordings: recordings, playable: playable ?? Set(recordings.map(\.id)), links: links,
        playFirst: playFirst, fullTracks: fullTracks, online: online)
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
}

@Suite struct PlaylistSourceTests {
    @Test func aRecordingPlaysOffline() {
        let r1 = rec("r1")
        #expect(choice(recordings: [r1], fullTracks: false, online: false) == .play(.recording(r1)))
    }

    @Test func anAlbumLinkIsNotPlaylistCapable() {
        let album = link("l1", "apple_music", url: album)
        #expect(choice(links: [album]) == .skip(.noCapableLink))
    }

    @Test func anAppleMusicSongPlaysWhenSubscribedAndOnline() {
        let l1 = link("l1", "apple_music")
        #expect(choice(links: [l1]) == .play(.link(l1)))
    }

    @Test func aPinnedSpotifyLinkPassesOverToARecording() {
        let r1 = rec("r1")
        let result = choice(userTune(link: "l2"), recordings: [r1], links: [link("l2", "spotify")])
        #expect(result == .play(.recording(r1)))
    }

    @Test func aPinnedSongWithoutFullTracksPassesOverToARecording() {
        let r1 = rec("r1")
        let result = choice(
            userTune(link: "l1"), recordings: [r1], links: [link("l1", "apple_music")], fullTracks: false)
        #expect(result == .play(.recording(r1)))
    }

    @Test func aPinnedAppleMusicAlbumPassesOverToASong() {
        let song = link("l2", "apple_music")
        let result = choice(userTune(link: "l1"), links: [link("l1", "apple_music", url: album), song])
        #expect(result == .play(.link(song)))
    }

    @Test func aPinnedRecordingWinsOverPlayFirst() {
        let r2 = rec("r2")
        let result = choice(
            userTune(recording: "r2"), recordings: [rec("r1"), r2], links: [link("l1", "apple_music")],
            playFirst: UserSettings.playFirstAppleMusic)
        #expect(result == .play(.recording(r2)))
    }

    @Test func playFirstAppleMusicPrefersTheSongOverARecording() {
        let l1 = link("l1", "apple_music")
        #expect(
            choice(recordings: [rec("r1")], links: [l1], playFirst: UserSettings.playFirstAppleMusic)
                == .play(.link(l1)))
    }

    @Test func playFirstAppleMusicFallsBackToARecordingOffline() {
        let r1 = rec("r1")
        let result = choice(
            recordings: [r1], links: [link("l1", "apple_music")], playFirst: UserSettings.playFirstAppleMusic,
            online: false)
        #expect(result == .play(.recording(r1)))
    }

    @Test func skipsWithNothingWhenThereIsNoRecordingOrLink() {
        #expect(choice() == .skip(.nothing))
        #expect(
            choice(recordings: [rec("r1", deleted: true)], links: [link("l1", "youtube", deleted: true)])
                == .skip(.nothing))
    }

    @Test func skipsWithNoCapableLinkWhenOnlyOtherLinksExist() {
        #expect(choice(links: [link("l1", "youtube"), link("l2", "spotify")]) == .skip(.noCapableLink))
    }

    @Test func skipsWithNeedsSubscriptionBeforeNeedsConnection() {
        let links = [link("l1", "apple_music")]
        #expect(choice(links: links, fullTracks: false, online: false) == .skip(.needsSubscription))
        #expect(choice(links: links, fullTracks: false) == .skip(.needsSubscription))
    }

    @Test func skipsWithNeedsConnectionWhenOffline() {
        #expect(choice(links: [link("l1", "apple_music")], online: false) == .skip(.needsConnection))
    }

    @Test func aPinnedRecordingWithNoAudioHerePassesOverToASong() {
        let song = link("l1", "apple_music")
        let result = choice(userTune(recording: "r1"), recordings: [rec("r1")], playable: [], links: [song])
        #expect(result == .play(.link(song)))
    }

    @Test func skipsRecordingsWithNoAudioHereWhenTheyAreTheOnlySource() {
        #expect(choice(recordings: [rec("r1")], playable: []) == .skip(.recordingsNotHere))
    }

    @Test func skipsRecordingsWithNoAudioHereBesideALinkThatCannotPlay() {
        let result = choice(recordings: [rec("r1")], playable: [], links: [link("l1", "spotify")])
        #expect(result == .skip(.recordingsNotHere))
    }

    @Test func aSongBesideRecordingsWithNoAudioHereSkipsForTheSong() {
        let links = [link("l1", "apple_music")]
        #expect(
            choice(recordings: [rec("r1")], playable: [], links: links, fullTracks: false) == .skip(.needsSubscription))
        #expect(choice(recordings: [rec("r1")], playable: [], links: links, online: false) == .skip(.needsConnection))
    }

    @Test func aDeletedRecordingWithNoAudioHereCountsAsNothing() {
        #expect(choice(recordings: [rec("r1", deleted: true)], playable: []) == .skip(.nothing))
    }
}
