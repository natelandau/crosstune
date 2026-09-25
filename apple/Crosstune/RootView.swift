import CrosstuneAPI
import CrosstuneAuth
import SwiftUI

/// Shows sign-in until someone is signed in, then the app for that user.
struct RootView: View {
    let session: AccountSession
    let client: Client

    var body: some View {
        Group {
            switch session.phase {
            case .loading:
                ProgressView()
            case .signedOut:
                SignInView()
            case .signedIn(let userID, let confirmed):
                SignedInView(session: session, client: client, userID: userID, confirmed: confirmed)
            }
        }
        .onChange(of: session.clerkUserID, initial: true) {
            session.clerkUserChanged()
        }
    }
}
