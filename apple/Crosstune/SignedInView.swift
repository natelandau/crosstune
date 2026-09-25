import CrosstuneAPI
import CrosstuneAuth
import SwiftUI

/// A stand-in for the app until the catalog screens exist: who is signed in, and the account.
struct SignedInView: View {
    let session: AccountSession
    let client: Client
    let userID: String
    let confirmed: Bool

    @State private var email: String?
    @State private var failure: String?
    @State private var showsAccount = false

    var body: some View {
        VStack(spacing: 16) {
            Text(email ?? userID)
                .font(.headline)
            if !confirmed {
                Text("Offline. Requests wait until you are back online.")
                    .foregroundStyle(.secondary)
            }
            if session.needsSignIn {
                Text("Sign in again to sync.")
                    .foregroundStyle(.red)
            }
            if let failure = failure ?? session.storeFailure {
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
        .task(id: confirmed) {
            guard confirmed else { return }
            await loadProfile()
        }
    }

    private func loadProfile() async {
        do {
            email = try await client.meV1MeGet().ok.body.json.email
            failure = nil
        } catch {
            failure = "Could not reach the API: \(error.localizedDescription)"
        }
    }
}
