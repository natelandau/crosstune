import AuthenticationServices
import ClerkKit
import Foundation

/// A provider the welcome screen offers for creating an account without a form.
public enum SignUpProvider: Sendable {
    case apple
    case google
}

/// How a native sign-up ended.
public enum NativeSignUpOutcome: Equatable, Sendable {
    /// Clerk holds a session, for a new account or an existing one it signed in to.
    case signedIn
    /// Clerk ended without an error but with no session, such as an existing account that needs
    /// a second factor, so Clerk's sign-in-or-up form finishes either kind of account.
    case needsForm
    /// The person closed Apple's sheet or Google's web page.
    case cancelled
}

/// The Clerk calls a native sign-up makes, so tests can replace Clerk.
protocol ClerkSignUpCalls: Sendable {
    func apple() async throws
    func google() async throws
    var hasSession: Bool { get async }
}

/// Runs Clerk's native Apple or Google sign-up and says how it ended.
public struct NativeSignUp: Sendable {
    public static let live = NativeSignUp(calls: LiveClerkSignUpCalls())
    /// Never reaches Clerk: every flow ends as a cancel, for previews.
    // periphery:ignore - read by the welcome previews
    public static let preview = NativeSignUp(
        calls: StubClerkSignUpCalls(error: CancellationError(), sessionAfterCall: false))

    private let calls: any ClerkSignUpCalls

    init(calls: any ClerkSignUpCalls) {
        self.calls = calls
    }

    /// Runs the provider's flow. A cancel returns `.cancelled`; any other failure rethrows.
    public func run(_ provider: SignUpProvider) async throws -> NativeSignUpOutcome {
        do {
            switch provider {
            case .apple: try await calls.apple()
            case .google: try await calls.google()
            }
        } catch let error where Self.isCancel(error) {
            return .cancelled
        }
        // Clerk transfers a sign-up for an existing account to a sign-in, so the session, not
        // the flow's result, says whether the person is in.
        return await calls.hasSession ? .signedIn : .needsForm
    }

    /// Apple's sheet reports a cancel as `ASAuthorizationError.canceled`. Google's web page
    /// reports `canceledLogin` from the system, or `CancellationError` or `URLError(.cancelled)`
    /// when Clerk ends it.
    static func isCancel(_ error: any Error) -> Bool {
        if let failure = error as? ASAuthorizationError, failure.code == .canceled { return true }
        if let failure = error as? ASWebAuthenticationSessionError, failure.code == .canceledLogin { return true }
        if let failure = error as? URLError, failure.code == .cancelled { return true }
        return error is CancellationError
    }
}

private struct LiveClerkSignUpCalls: ClerkSignUpCalls {
    /// Clerk's transferable Apple sign-in, not `signUpWithApple()`: it tries a sign-up first and
    /// keeps Apple's name, falls back to a sign-in when the instance restricts sign-ups so an
    /// existing account still gets in, and throws a transferred sign-in's verification error.
    @MainActor func apple() async throws {
        try await Clerk.shared.auth.signInWithApple(transferable: true)
    }

    @MainActor func google() async throws {
        try await Clerk.shared.auth.signInWithOAuth(provider: .google)
    }

    @MainActor var hasSession: Bool { Clerk.shared.session != nil }
}

/// Replaces Clerk in previews and tests: each call fails with `error` when given one, and
/// otherwise leaves `hasSession` as the flow would.
struct StubClerkSignUpCalls: ClerkSignUpCalls {
    var error: (any Error)?
    var sessionAfterCall = true

    func apple() async throws { if let error { throw error } }
    func google() async throws { if let error { throw error } }
    var hasSession: Bool { sessionAfterCall }
}
