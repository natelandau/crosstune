import CrosstuneAPI
import CrosstuneAuth
import SwiftUI

@main
struct CrosstuneApp: App {
    @State private var session: AccountSession
    private let client: Client

    init() {
        let configuration = AppConfiguration.main
        let session = AccountSession(publishableKey: configuration.clerkPublishableKey)
        _session = State(initialValue: session)
        client = .crosstune(
            origin: configuration.apiOrigin,
            tokens: ClerkTokens(),
            clientVersion: configuration.clientVersion,
            onUnauthorized: { await session.sessionRejected() }
        )
    }

    var body: some Scene {
        WindowGroup {
            RootView(session: session, client: client)
        }
    }
}
