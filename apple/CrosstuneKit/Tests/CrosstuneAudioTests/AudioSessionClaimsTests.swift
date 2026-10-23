import Testing

@testable import CrosstuneAudio

@Suite struct AudioSessionClaimsTests {
    private let claims = AudioSessionClaims()
    private let tuner = AudioSessionOwner()
    private let recorder = AudioSessionOwner()

    private func releases(_ owner: AudioSessionOwner) -> Bool {
        var ran = false
        claims.release(owner) { ran = true }
        return ran
    }

    @Test func theLastOwnerToClaimDeactivates() {
        claims.claim(tuner)
        #expect(releases(tuner))
    }

    @Test func anEarlierOwnerNeverDeactivatesUnderALaterOne() {
        claims.claim(tuner)
        claims.claim(recorder)

        #expect(!releases(tuner))
        #expect(releases(recorder))
    }

    @Test func deactivatesOncePerClaim() {
        claims.claim(tuner)
        #expect(releases(tuner))
        #expect(!releases(tuner))
    }

    @Test func nothingDeactivatesBeforeAnyClaim() {
        #expect(!releases(tuner))
    }

    @Test func aClaimAskedForBeforeAYieldThrowsAndNeverActivates() {
        let asked = claims.yields
        claims.claim(recorder)
        claims.yieldToPlayback()
        var activated = false

        #expect(throws: YieldedToPlayback.self) {
            try claims.claim(tuner, unlessYieldedSince: asked) { activated = true }
        }
        #expect(!activated)
        #expect(releases(recorder))
    }

    @Test func aYieldSinceTheClaimLetsGoWithoutDeactivating() throws {
        let asked = claims.yields
        try claims.claim(tuner, unlessYieldedSince: asked) {}
        claims.yieldToPlayback()
        var ran = false
        claims.release(tuner, unlessYieldedSince: asked) { ran = true }

        #expect(!ran)
        #expect(!releases(tuner))
    }

    @Test func noYieldSinceTheClaimDeactivates() throws {
        let asked = claims.yields
        try claims.claim(tuner, unlessYieldedSince: asked) {}
        var ran = false
        claims.release(tuner, unlessYieldedSince: asked) { ran = true }

        #expect(ran)
    }

    @Test func aClaimAskedForBeforeAnotherOwnersClaimNeverActivates() {
        let asked = claims.yields
        claims.claim(recorder)
        var activated = false

        #expect(throws: YieldedToPlayback.self) {
            try claims.claim(tuner, unlessYieldedSince: asked) { activated = true }
        }
        #expect(!activated)
        #expect(releases(recorder))
    }

    @Test func aClaimWithNoYieldSinceActivatesAndHolds() throws {
        var activated = false
        try claims.claim(tuner, unlessYieldedSince: claims.yields) { activated = true }

        #expect(activated)
        #expect(releases(tuner))
    }
}
