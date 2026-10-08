import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneStore
import SwiftUI

/// The last stop before an account, and everything in it on every device, is gone for good.
/// Held open until the request settles: there is no state to return to partway through erasing
/// an account.
public struct DeleteAccountSheet: View {
    public static let title = "Delete account"
    public static let heading = "Delete your account?"
    public static let lead = "This permanently deletes everything in your account, on every device:"
    public static let settingsLine = "Your settings and instruments"
    public static let unsyncedLine = "Changes that have not synced yet are lost too."
    public static let cannotUndo = "This cannot be undone."
    public static let noRecovery = " There is no way to recover your account or anything in it."
    public static let confirmLabel = "Type \(confirmationText) to confirm"
    public static let deleting = "Deleting…"

    static let confirmationText = "DELETE"

    let session: AccountSession
    let counts: CountsState

    @Environment(\.dismiss) private var dismiss
    @Environment(\.spacing) private var spacing
    @Environment(\.analytics) private var analytics
    @State private var visit = AccountDeletionVisit()
    @State private var text = ""
    @State private var pending = false
    @State private var failure: String?

    public init(session: AccountSession, counts: CountsState) {
        self.session = session
        self.counts = counts
    }

    /// Whether the count list is still loading, ready, or could not be read at all: the local
    /// store never opened, or its query failed. The delete itself runs on the server, so an
    /// unavailable count never blocks it.
    public enum CountsState: Equatable, Sendable {
        case loading
        case available(AccountCounts)
        case unavailable
    }

    /// Whether typed text confirms the delete: trimmed, matched without regard to case.
    public static func confirmationMatches(_ text: String) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() == confirmationText
    }

    /// One line per kind with a live row; a kind with none is left out.
    public static func countLines(_ counts: AccountCounts) -> [String] {
        [
            countLine(counts.tunes, "tune", "tunes"),
            countLine(counts.lists, "list", "lists"),
            countLine(counts.recordings, "recording and its audio", "recordings and their audio"),
        ].compactMap(\.self)
    }

    /// The whole list, settings included, only once the counts are known, so it never
    /// understates what is about to be lost.
    public static func listLines(_ state: CountsState) -> [String] {
        guard case .available(let counts) = state else { return [] }
        return countLines(counts) + [settingsLine]
    }

    /// Hidden only while the counts load; an unavailable count still warns about unsent changes.
    public static func showsUnsyncedLine(_ state: CountsState) -> Bool {
        if case .loading = state { return false }
        return true
    }

    private static func countLine(_ count: Int, _ singular: String, _ plural: String) -> String? {
        guard count > 0 else { return nil }
        return "\(count) \(count == 1 ? singular : plural)"
    }

    /// Delete waits out a loading count, so the list on screen never turns out to have been
    /// partial. An unavailable count does not hold it back, since the delete does not read the
    /// local store.
    public static func deleteEnabled(_ state: CountsState, text: String, pending: Bool) -> Bool {
        guard !pending, confirmationMatches(text) else { return false }
        if case .loading = state { return false }
        return true
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: spacing.stackGap) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.largeTitle)
                            .foregroundStyle(.red)
                            .accessibilityHidden(true)
                        Text(Self.heading)
                            .font(.headline)
                        Text(Self.lead)
                    }
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .listRowBackground(Color.clear)
                    ForEach(Self.listLines(counts), id: \.self) { Text($0) }
                    if Self.showsUnsyncedLine(counts) {
                        Text(Self.unsyncedLine)
                    }
                    Text("**\(Self.cannotUndo)**\(Self.noRecovery)")
                }
                Section {
                    TextField(Self.confirmLabel, text: $text)
                        .contentMask()
                        #if os(iOS)
                            .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .disabled(pending)
                    Button(role: .destructive) {
                        runDelete()
                    } label: {
                        Text(pending ? Self.deleting : Self.title)
                    }
                    .disabled(!Self.deleteEnabled(counts, text: text, pending: pending))
                } footer: {
                    if let failure {
                        Text(failure)
                            .foregroundStyle(.red)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(Self.title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(TuneFormSheet.cancel) { dismiss() }
                        .disabled(pending)
                }
            }
        }
        #if os(iOS)
            .presentationDetents([.large])
            .shellSheet()
        #else
            .macSheetFrame(.form(minHeight: 480))
            .shellSheet()
        #endif
        .interactiveDismissDisabled(pending)
        .onAppear { visit.opened(analytics) }
        .onDisappear { visit.closed(analytics) }
    }

    private func runDelete() {
        pending = true
        failure = nil
        visit.confirmed()
        Task {
            defer { pending = false }
            do {
                try await session.deleteAccount()
                dismiss()
            } catch {
                visit.failed()
                failure = failureMessage(error)
            }
        }
    }
}

/// One showing of the delete confirmation, reported as it opens and, when it closes without
/// deleting, as cancelled. A delete under way ends the visit whatever closes the sheet, since
/// the account going signs the musician out from under it.
struct AccountDeletionVisit {
    private enum Phase {
        case closed
        case open
        case deleting
    }

    private var phase = Phase.closed

    mutating func opened(_ analytics: AnalyticsClient) {
        guard phase == .closed else { return }
        phase = .open
        analytics.send(.accountDeletionStarted)
    }

    /// The musician confirmed and the delete began.
    mutating func confirmed() {
        if phase == .open { phase = .deleting }
    }

    /// The delete was refused, so the sheet stays up for another try or a cancel.
    mutating func failed() {
        if phase == .deleting { phase = .open }
    }

    mutating func closed(_ analytics: AnalyticsClient) {
        if phase == .open { analytics.send(.accountDeletionCancelled) }
        phase = .closed
    }
}
