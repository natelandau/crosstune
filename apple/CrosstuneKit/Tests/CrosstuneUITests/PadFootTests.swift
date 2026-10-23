import Testing

@testable import CrosstuneUI

@MainActor
@Suite struct PadFootTests {
    @Test func idleShowsRecordOnly() {
        #expect(!PadFoot.showsPlayer(PlayerModel(), nil))
    }

    @Test func playingShowsThePlayerBesideRecord() {
        let player = PlayerModel()
        player.play(PlayerItem(kind: .link, id: "l", title: "Soldier's Joy"))
        #expect(PadFoot.showsPlayer(player, nil))
    }

    @Test func recordStandsDownWhileCovered() {
        let cover = ShellCover()
        #expect(PadFoot.recordIsEnabled(cover: nil))
        #expect(PadFoot.recordIsEnabled(cover: cover))
        cover.claim()
        #expect(!PadFoot.recordIsEnabled(cover: cover))
    }

    @Test func footShowsOnlyWithSomethingInIt() {
        let player = PlayerModel()
        #expect(!PadFoot.isShown(showsRecord: false, player, nil))
        player.play(PlayerItem(kind: .link, id: "l", title: "Soldier's Joy"))
        #expect(PadFoot.isShown(showsRecord: false, player, nil))
    }

    @Test func footKeepsRecordWhenRecordIsNotATab() {
        #expect(PadFoot.isShown(showsRecord: true, PlayerModel(), nil))
    }

    @Test func columnsClearTheFootOnlyWhileItShows() {
        #expect(PadStyle.footClearance(footShown: true) == PadStyle.footClearance)
        #expect(PadStyle.footClearance(footShown: false) == 0)
    }
}
