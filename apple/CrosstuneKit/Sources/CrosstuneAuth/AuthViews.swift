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

/// The account in a sheet of its own, for screens that have no Settings form to hold
/// ``AccountSections``.
public struct AccountView: View {
    public static let done = "Done"

    let session: AccountSession

    @Environment(\.dismiss) private var dismiss

    public init(session: AccountSession) {
        self.session = session
    }

    public var body: some View {
        NavigationStack {
            Form {
                AccountSections(session: session)
            }
            .formStyle(.grouped)
            .navigationTitle(AccountSections.title)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(Self.done) { dismiss() }
                }
            }
        }
    }
}

/// The account's sections of a form: who is signed in, sign-out, and account deletion.
///
/// Not Clerk's `UserProfileView`, which always offers its own sign-out and so would skip the
/// guard that keeps unsent changes from being deleted with the catalog.
public struct AccountSections: View {
    public static let title = "Account"
    public static let signOut = "Sign out"
    public static let signOutOffline = "Sign out needs a connection."
    public static let signedInOffline = "Signed in (offline)"
    public static let deleteAccount = "Delete account"
    public static let deleteQuestion = "Delete your account?"
    public static let deleteWarning =
        "This deletes your tunes, lists, and recordings from every device. Changes that have not synced are lost."

    let session: AccountSession

    @State private var pending = false
    @State private var signOutFailure: String?
    @State private var deleteFailure: String?
    @State private var confirmsDelete = false

    public init(session: AccountSession) {
        self.session = session
    }

    public var body: some View {
        Section {
            Text(identity)
            Button(Self.signOut, role: .destructive) {
                run(failure: $signOutFailure) { try await session.signOut() }
            }
            .disabled(pending || session.isOffline)
        } header: {
            Text(Self.title)
        } footer: {
            if let footer = session.isOffline ? Self.signOutOffline : signOutFailure {
                Text(footer)
            }
        }
        Section {
            Button(Self.deleteAccount, role: .destructive) { confirmsDelete = true }
                .disabled(pending)
                .confirmationDialog(Self.deleteQuestion, isPresented: $confirmsDelete, titleVisibility: .visible) {
                    Button(Self.deleteAccount, role: .destructive) {
                        run(failure: $deleteFailure) { try await session.deleteAccount() }
                    }
                } message: {
                    Text(Self.deleteWarning)
                }
        } footer: {
            if let deleteFailure { Text(deleteFailure) }
        }
    }

    /// Clerk has no user until it loads, so offline the row says so instead of an email.
    private var identity: String {
        if let email = session.email { return email }
        if !session.isOffline, case .signedIn(let userID, _) = session.phase { return userID }
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
