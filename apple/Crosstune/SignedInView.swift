import CrosstuneAPI
import CrosstuneAuth
import SwiftUI

/// A stand-in for the app until the catalog screens exist: who is signed in, and the account.
struct SignedInView: View {
    let session: AccountSession
    let client: Client
    let userID: String

    @State private var email: String?
    @State private var failure: String?
    @State private var showsAccount = false

    var body: some View {
        VStack(spacing: 16) {
            Text(session.email ?? email ?? userID)
                .font(.headline)
            if session.isOffline {
                Text("Offline. Requests wait until you are back online.")
                    .foregroundStyle(.secondary)
            }
            if session.needsSignIn {
                Text("Sign in again to sync.")
                    .foregroundStyle(.red)
            }
            if let failure = (session.isOffline ? nil : failure) ?? session.storeFailure {
                Text(failure)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            Button("Account") { showsAccount = true }
        }
        .padding()
        .sheet(isPresented: $showsAccount) {
            AccountView(session: session)
        }
        .task(id: session.isOffline) {
            failure = nil
            guard !session.isOffline else { return }
            await loadProfile()
        }
    }

    private func loadProfile() async {
        do {
            email = try await client.meV1MeGet().ok.body.json.email
            failure = nil
        } catch {
            // Going offline cancels the request, and its failure says nothing new.
            guard !Task.isCancelled else { return }
            failure = "Could not reach the API: \(error.localizedDescription)"
        }
    }
}
