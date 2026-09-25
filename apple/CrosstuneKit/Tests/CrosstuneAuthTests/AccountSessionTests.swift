import Foundation
import Testing

@testable import CrosstuneAuth

@Test func waitsForClerkDuringTheGracePeriod() {
    let phase = AccountSession.phase(
        clerkLoaded: false, clerkUserID: nil, rememberedUserID: "user_a", graceElapsed: false)
    #expect(phase == .loading)
}

@Test func opensOnTheRememberedUserWhenClerkDoesNotLoad() {
    let phase = AccountSession.phase(
        clerkLoaded: false, clerkUserID: nil, rememberedUserID: "user_a", graceElapsed: true)
    #expect(phase == .signedIn(userID: "user_a", confirmed: false))
}

@Test func asksForSignInWhenClerkDoesNotLoadAndNoOneIsRemembered() {
    let phase = AccountSession.phase(
        clerkLoaded: false, clerkUserID: nil, rememberedUserID: nil, graceElapsed: true)
    #expect(phase == .signedOut)
}

@Test func trustsClerkOnceItLoads() {
    let signedIn = AccountSession.phase(
        clerkLoaded: true, clerkUserID: "user_b", rememberedUserID: "user_a", graceElapsed: false)
    #expect(signedIn == .signedIn(userID: "user_b", confirmed: true))

    let signedOut = AccountSession.phase(
        clerkLoaded: true, clerkUserID: nil, rememberedUserID: "user_a", graceElapsed: true)
    #expect(signedOut == .signedOut)
}

@Test func remembersAndForgetsTheUser() throws {
    let suite = "crosstune.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let remembered = RememberedUser(defaults: defaults)

    remembered.userID = "user_a"
    #expect(RememberedUser(defaults: defaults).userID == "user_a")

    remembered.userID = nil
    #expect(RememberedUser(defaults: defaults).userID == nil)
}
