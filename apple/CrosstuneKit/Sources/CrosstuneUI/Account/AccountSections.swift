import CrosstuneAuth
import CrosstuneStore
import OSLog
import SwiftUI

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
        .shellSheet()
    }
}

/// The account's section of a form: who is signed in, sign-out, and account deletion.
///
/// Not Clerk's `UserProfileView`, which always offers its own sign-out and so would skip the
/// guard that keeps unsent changes from being deleted with the catalog.
public struct AccountSections: View {
    nonisolated public static let title = "Account"
    public static let signOut = "Sign out"
    public static let offlineFooter = "Signing out and deleting your account need a connection."
    public static let updateRequiredFooter =
        "Signing out and deleting your account need the latest version of Crosstune."
    public static let signedInOffline = "Signed in (offline)"

    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "account")

    let session: AccountSession

    @State private var pending = false
    @State private var signOutFailure: String?
    @State private var countsState: DeleteAccountSheet.CountsState = .loading
    @State private var showsDeleteSheet = false

    public init(session: AccountSession) {
        self.session = session
    }

    public var body: some View {
        Section {
            Text(Self.identity(session))
            Button(Self.signOut, role: .destructive) {
                run(failure: $signOutFailure) { try await session.signOut() }
            }
            .disabled(pending || session.isOffline)
            Button(DeleteAccountSheet.title, role: .destructive) { openDeleteSheet() }
                .disabled(pending || session.isOffline)
                .sheet(isPresented: $showsDeleteSheet) {
                    DeleteAccountSheet(session: session, counts: countsState)
                }
        } header: {
            Text(Self.title)
        } footer: {
            if let footer = Self.footer(
                isOffline: session.isOffline, updateRequired: session.updateRequired, failure: signOutFailure)
            {
                Text(footer)
            }
        }
    }

    /// Why sign-out and deletion are disabled, or the last sign-out failure while they are not.
    static func footer(isOffline: Bool, updateRequired: Bool, failure: String?) -> String? {
        if updateRequired { return updateRequiredFooter }
        return isOffline ? offlineFooter : failure
    }

    /// Clerk has no user until it loads, so offline the row says so instead of an email.
    static func identity(_ session: AccountSession) -> String {
        identity(email: session.email, phase: session.phase, hasNetwork: session.hasNetwork)
    }

    /// Reads the connection alone, not ``AccountSession/isOffline``, which an update required
    /// also sets while the connection is fine.
    static func identity(email: String?, phase: AccountSession.Phase, hasNetwork: Bool) -> String {
        if let email { return email }
        if hasNetwork, case .signedIn(let userID, confirmed: true) = phase { return userID }
        return signedInOffline
    }

    /// Opens at once and counts in the background: the delete itself runs on the server, so a
    /// missing store or a failed query never keeps the sheet from showing, only the count list.
    private func openDeleteSheet() {
        countsState = .loading
        showsDeleteSheet = true
        Task {
            guard let store = session.store else {
                Self.logger.error("No open store to count for the delete sheet")
                countsState = .unavailable
                return
            }
            do {
                countsState = .available(try await store.accountCounts())
            } catch {
                Self.logger.error("Could not count account data: \(error, privacy: .public)")
                countsState = .unavailable
            }
        }
    }

    private func run(failure: Binding<String?>, _ action: @escaping @MainActor () async throws -> Void) {
        pending = true
        failure.wrappedValue = nil
        Task {
            defer { pending = false }
            do {
                try await action()
            } catch {
                failure.wrappedValue = failureMessage(error)
            }
        }
    }
}
