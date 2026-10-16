import AuthenticationServices

#if os(iOS)
    import UIKit
#else
    import AppKit
#endif

/// A fresh Sign in with Apple authorization for the signed-in Apple Account, asked for only to
/// get a one-time code. The API trades that code for a token it can revoke.
@MainActor
enum AppleAuthorization {
    /// Presents Apple's sheet and returns its authorization code. Any error, a cancel
    /// included, rethrows.
    static func code() async throws -> String {
        let controller = ASAuthorizationController(authorizationRequests: [
            ASAuthorizationAppleIDProvider().createRequest()
        ])
        let delegate = Delegate()
        controller.delegate = delegate
        controller.presentationContextProvider = delegate
        let code = try await withCheckedThrowingContinuation { continuation in
            delegate.continuation = continuation
            controller.performRequests()
        }
        // The controller holds its delegate weakly, so both must outlive the request.
        withExtendedLifetime((controller, delegate)) {}
        return code
    }

    private final class Delegate: NSObject, ASAuthorizationControllerDelegate,
        ASAuthorizationControllerPresentationContextProviding
    {
        var continuation: CheckedContinuation<String, any Error>?

        func authorizationController(
            controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization
        ) {
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let data = credential.authorizationCode,
                let code = String(data: data, encoding: .utf8)
            else {
                resume(with: .failure(ASAuthorizationError(.invalidResponse)))
                return
            }
            resume(with: .success(code))
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
            resume(with: .failure(error))
        }

        func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
            #if os(iOS)
                let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                let windows = scenes.flatMap(\.windows)
                if let window = windows.first(where: \.isKeyWindow) ?? windows.first { return window }
                if let scene = scenes.first { return ASPresentationAnchor(windowScene: scene) }
                return ASPresentationAnchor()
            #else
                return NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
            #endif
        }

        private func resume(with result: Result<String, any Error>) {
            continuation?.resume(with: result)
            continuation = nil
        }
    }
}
