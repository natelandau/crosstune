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
        #if os(macOS)
            MacSheet(
                title: AccountSections.title, size: .fitted(.medium), cancel: nil,
                primary: .init(Self.done) { dismiss() }, escape: { dismiss() }
            ) {
                VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                    AccountSections(session: session)
                }
            }
            .shellSheet()
        #else
            NavigationStack {
                PaperForm {
                    AccountSections(session: session)
                }
                .navigationTitle(AccountSections.title)
                .toolbar {
                    ConfirmToolbarItem {
                        Button(Self.done) { dismiss() }
                    }
                }
            }
            .shellSheet()
        #endif
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
    #if os(macOS)
        /// Cards shown between the account and the delete card, such as the catalog summary.
        private let interlude: AnyView?
    #endif

    @State private var pending = false
    @State private var signOutFailure: String?
    @State private var countsState: DeleteAccountSheet.CountsState = .loading
    @State private var showsDeleteSheet = false
    #if DEBUG
        /// The sample's store, which the counts read in place of a session's.
        @Environment(\.store) private var sampleStore
    #endif

    public init(session: AccountSession) {
        self.session = session
        #if os(macOS)
            interlude = nil
        #endif
    }

    #if os(macOS)
        /// - Parameter interlude: Cards shown after the account and before the delete card,
        ///   which always comes last.
        init(session: AccountSession, @ViewBuilder interlude: () -> some View) {
            self.session = session
            self.interlude = AnyView(interlude())
        }

        /// The Mac's cards, in order.
        enum MacGroup: Hashable {
            /// Who is signed in, with Sign out.
            case identity
            /// The caller's cards.
            case interlude
            /// Delete account, alone in its card and last, as a destructive action goes.
            case deleteAccount
        }

        nonisolated static let macGroups: [MacGroup] = [.identity, .interlude, .deleteAccount]
        /// Signing out keeps everything on the server, so on the Mac it is an ordinary action.
        nonisolated static let macSignOutRole: MacButtonStyle.Role = .secondary
        nonisolated static let macDeleteRole: MacButtonStyle.Role = .destructive
        /// The delete row's button, beside the row that names the account.
        nonisolated static let deleteAccountMac = "Delete…"

        public var body: some View {
            ForEach(Self.macGroups, id: \.self) { group in
                switch group {
                case .identity: macIdentity
                case .interlude: interlude
                case .deleteAccount: macDelete
                }
            }
        }

        private var macIdentity: some View {
            let blocked = session.isOffline || session.updateRequired
            return MacFormSection(Self.title, failure: blocked ? nil : signOutFailure) {
                // Why Sign out stands down reads under the account it would sign out.
                MacSettingsRow(
                    Self.identity(session),
                    help: Self.footer(
                        isOffline: session.isOffline, updateRequired: session.updateRequired, failure: nil)
                ) {
                    MacSettingsButton(Self.signOut, role: Self.macSignOutRole) {
                        run(failure: $signOutFailure) { try await session.signOut() }
                    }
                    .disabled(pending || session.isOffline)
                }
            }
        }

        private var macDelete: some View {
            MacFormSection {
                MacSettingsRow(DeleteAccountSheet.title, help: DeleteAccountSheet.cannotUndo) {
                    MacSettingsButton(Self.deleteAccountMac, role: Self.macDeleteRole) { openDeleteSheet() }
                        .disabled(pending || session.isOffline)
                        .sheet(isPresented: $showsDeleteSheet) {
                            DeleteAccountSheet(session: session, counts: countsState)
                        }
                        #if DEBUG
                            .opensForSample(.deleteAccount, when: sampleStore != nil) { openSampleDeleteSheet() }
                        #endif
                }
            }
        }
    #else
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
                    #if DEBUG
                        .opensForSample(.deleteAccount, when: sampleStore != nil) { openSampleDeleteSheet() }
                    #endif
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
    #endif

    #if DEBUG
        private func openSampleDeleteSheet() {
            showsDeleteSheet = true
            Task {
                countsState = (try? await sampleStore?.accountCounts()).map { .available($0) } ?? .unavailable
            }
        }
    #endif

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
