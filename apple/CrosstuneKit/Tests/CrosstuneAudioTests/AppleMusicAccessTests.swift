import MusicKit
import Testing

@testable import CrosstuneAudio

@Suite struct AppleMusicAccessStateTests {
    @Test(
        arguments: [
            (MusicAuthorization.Status.notDetermined, false, AppleMusicAccessState.notAsked),
            (.authorized, true, .fullTracks),
            (.authorized, false, .noSubscription),
            (.denied, true, .declined),
            (.restricted, true, .declined),
        ] as [(MusicAuthorization.Status, Bool, AppleMusicAccessState)]
    )
    func mapsAuthorizationAndSubscription(
        status: MusicAuthorization.Status, canPlay: Bool, expected: AppleMusicAccessState
    ) {
        #expect(AppleMusicAccessState.make(authorization: status, canPlayCatalogContent: canPlay) == expected)
    }
}
