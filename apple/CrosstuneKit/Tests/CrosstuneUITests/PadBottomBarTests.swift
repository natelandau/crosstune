import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct PadBottomBarTests {
    @Test func idleShowsRecordOnly() {
        #expect(!PadBottomBar.showsPlayer(PlayerModel(), nil))
    }

    @Test func playingShowsThePlayerBesideRecord() {
        let player = PlayerModel()
        player.play(PlayerItem(kind: .link, id: "l", title: "Soldier's Joy"))
        #expect(PadBottomBar.showsPlayer(player, nil))
    }

    @Test func recordIsDisabledWhileCovered() {
        let cover = ShellCover()
        #expect(PadBottomBar.recordIsEnabled(cover: nil))
        #expect(PadBottomBar.recordIsEnabled(cover: cover))
        cover.claim()
        #expect(!PadBottomBar.recordIsEnabled(cover: cover))
    }

    @Test func bottomBarShowsOnlyWithSomethingInIt() {
        let player = PlayerModel()
        #expect(!PadBottomBar.isShown(showsRecord: false, player, nil))
        player.play(PlayerItem(kind: .link, id: "l", title: "Soldier's Joy"))
        #expect(PadBottomBar.isShown(showsRecord: false, player, nil))
    }

    @Test func bottomBarKeepsRecordWhenRecordIsNotATab() {
        #expect(PadBottomBar.isShown(showsRecord: true, PlayerModel(), nil))
    }

    @Test func columnsClearTheFootOnlyWhileItShows() {
        #expect(PadStyle.bottomBarClearance(bottomBarShown: true) == PadStyle.bottomBarClearance)
        #expect(PadStyle.bottomBarClearance(bottomBarShown: false) == 0)
    }
}
