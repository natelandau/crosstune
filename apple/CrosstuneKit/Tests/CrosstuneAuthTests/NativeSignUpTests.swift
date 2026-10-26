import AuthenticationServices
import Foundation
import Testing

@testable import CrosstuneAuth

@Test(arguments: [SignUpProvider.apple, .google])
func aSessionAfterTheCallIsSignedIn(provider: SignUpProvider) async throws {
    let signUp = NativeSignUp(calls: StubClerkSignUpCalls())
    #expect(try await signUp.run(provider) == .signedIn)
}

@Test func anExistingAccountAlsoSignsIn() async throws {
    // Clerk transfers a sign-up for an existing account to a sign-in, which ends with a session
    // just as a new account does.
    let signUp = NativeSignUp(calls: StubClerkSignUpCalls(sessionAfterCall: true))
    #expect(try await signUp.run(.apple) == .signedIn)
}

@Test(arguments: [SignUpProvider.apple, .google])
func noSessionAfterTheCallNeedsTheForm(provider: SignUpProvider) async throws {
    let signUp = NativeSignUp(calls: StubClerkSignUpCalls(sessionAfterCall: false))
    #expect(try await signUp.run(provider) == .needsForm)
}

@Test func cancellingApplesSheetIsCancelled() async throws {
    let signUp = NativeSignUp(
        calls: StubClerkSignUpCalls(error: ASAuthorizationError(.canceled), sessionAfterCall: false))
    #expect(try await signUp.run(.apple) == .cancelled)
}

@Test func cancellingGooglesWebSessionIsCancelled() async throws {
    let closed = NativeSignUp(
        calls: StubClerkSignUpCalls(error: ASWebAuthenticationSessionError(.canceledLogin), sessionAfterCall: false))
    #expect(try await closed.run(.google) == .cancelled)

    let cancelled = NativeSignUp(calls: StubClerkSignUpCalls(error: CancellationError(), sessionAfterCall: false))
    #expect(try await cancelled.run(.google) == .cancelled)

    let stopped = NativeSignUp(calls: StubClerkSignUpCalls(error: URLError(.cancelled), sessionAfterCall: false))
    #expect(try await stopped.run(.google) == .cancelled)
}

@Test func otherErrorsThrowRatherThanOpenTheForm() async {
    // A failed verification ends with no session, and must surface its error, not the form.
    let signUp = NativeSignUp(
        calls: StubClerkSignUpCalls(error: URLError(.notConnectedToInternet), sessionAfterCall: false))
    await #expect(throws: URLError(.notConnectedToInternet)) {
        try await signUp.run(.apple)
    }
}
