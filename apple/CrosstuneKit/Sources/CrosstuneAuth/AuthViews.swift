import ClerkKit
import ClerkKitUI
import SwiftUI

/// Clerk's sign-in and sign-up flow, with every method the instance enables.
public struct SignInView: View {
    public init() {}

    public var body: some View {
        AuthView(isDismissible: false)
            .environment(Clerk.shared)
    }
}

/// The account: who is signed in, sign-out, and account deletion.
///
/// Not Clerk's `UserProfileView`, which always offers its own sign-out and so would skip the
/// guard that keeps unsent changes from being deleted with the catalog.
public struct AccountView: View {
    public static let signOut = "Sign out"
    public static let signOutOffline = "Sign out needs a connection."
    public static let signedInOffline = "Signed in (offline)"
    public static let deleteAccount = "Delete account"
    public static let deleteQuestion = "Delete your account?"
    public static let deleteWarning =
        "This deletes your tunes, lists, and recordings from every device. Changes that have not synced are lost."

    let session: AccountSession

    @Environment(\.dismiss) private var dismiss
    @State private var pending = false
    @State private var signOutFailure: String?
    @State private var deleteFailure: String?
    @State private var confirmsDelete = false

    public init(session: AccountSession) {
        self.session = session
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(identity)
                    Button(Self.signOut, role: .destructive) {
                        run(failure: $signOutFailure) { try await session.signOut() }
                    }
                    .disabled(pending || !confirmed)
                } footer: {
                    if let footer = confirmed ? signOutFailure : Self.signOutOffline {
                        Text(footer)
                    }
                }
                Section {
                    Button(Self.deleteAccount, role: .destructive) { confirmsDelete = true }
                        .disabled(pending)
                } footer: {
                    if let deleteFailure { Text(deleteFailure) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Account")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog(Self.deleteQuestion, isPresented: $confirmsDelete, titleVisibility: .visible) {
                Button(Self.deleteAccount, role: .destructive) {
                    run(failure: $deleteFailure) { try await session.deleteAccount() }
                }
            } message: {
                Text(Self.deleteWarning)
            }
        }
    }

    private var confirmed: Bool {
        if case .signedIn(_, confirmed: true) = session.phase { return true }
        return false
    }

    /// Clerk has no user until it loads, so offline the row says so instead of an email.
    private var identity: String {
        if let email = Clerk.shared.user?.primaryEmailAddress?.emailAddress { return email }
        if case .signedIn(let userID, confirmed: true) = session.phase { return userID }
        return Self.signedInOffline
    }

    private func run(failure: Binding<String?>, _ action: @escaping @MainActor () async throws -> Void) {
        pending = true
        failure.wrappedValue = nil
        Task {
            defer { pending = false }
            do {
                try await action()
            } catch {
                failure.wrappedValue = error.localizedDescription
            }
        }
    }
}
