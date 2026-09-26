import CrosstuneAuth
import CrosstuneUI
import SwiftUI

/// Shows sign-in until someone is signed in, then the app for that user.
struct RootView: View {
    let session: AccountSession
    let player: PlayerModel
    let stage: EmbedStage
    let recorders: RecorderHost

    @Environment(\.undoManager) private var undoManager

    var body: some View {
        Group {
            switch session.phase {
            case .loading:
                ProgressView()
            case .signedOut:
                SignInView()
            case .signedIn:
                if let store = session.store {
                    AppShell(store: store, player: player, stage: stage, recorders: recorders)
                        .environment(session.syncEngine)
                } else if let failure = session.storeFailure {
                    StoreFailureView(session: session, failure: failure)
                } else {
                    // Loading is silence, but the view must exist: an empty body drops the
                    // modifiers below, and with them the phase change that opens the store.
                    Color.clear
                }
            }
        }
        .environment(session)
        .onChange(of: session.clerkUserID, initial: true) {
            session.clerkUserChanged()
        }
        .onChange(of: session.phase, initial: true) {
            session.phaseChanged()
        }
        // What played, and what the Edit menu could undo, belong to the catalog they came from.
        .onChange(of: session.store?.userID) {
            player.close()
            undoManager?.removeAllActions()
        }
    }
}

/// The signed-in user's catalog did not open. The account stays reachable, so they can sign
/// out and start over.
private struct StoreFailureView: View {
    let session: AccountSession
    let failure: String

    @State private var showsAccount = false

    var body: some View {
        ContentUnavailableView {
            Label("Your tunes did not open", systemImage: "exclamationmark.triangle")
        } description: {
            Text(failure)
                .textSelection(.enabled)
        } actions: {
            Button(AccountSections.title) { showsAccount = true }
        }
        .sheet(isPresented: $showsAccount) {
            AccountView(session: session)
        }
    }
}
