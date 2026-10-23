import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneBilling
import CrosstuneStore
import SwiftUI

/// The last stop before an account, and everything in it on every device, is gone for good.
/// Held open until the request settles: there is no state to return to partway through erasing
/// an account.
public struct DeleteAccountSheet: View {
    nonisolated public static let title = "Delete account"
    public static let heading = "Delete your account?"
    public static let lead = "This permanently deletes everything in your account, on every device:"
    public static let settingsLine = "Your settings and instruments"
    public static let unsyncedLine = "Changes that have not synced yet are lost too."
    public static let cannotUndo = "This cannot be undone."
    public static let noRecovery = " There is no way to recover your account or anything in it."
    public static let confirmLabel = "Type \(confirmationText) to confirm"
    public static let deleting = "Deleting…"
    public static let confirmingWithApple = "Confirming with Apple…"
    public static let appleSubscriptionLine =
        "Your App Store subscription keeps billing until you cancel it in App Store settings."
    public static let stripeSubscriptionLine =
        "Your Premium subscription is cancelled now, with no refund for the rest of the period."
    public static let appleLine = "You'll confirm with Apple so Crosstune is removed from your Apple Account."

    static let confirmationText = "DELETE"

    let session: AccountSession
    let counts: CountsState

    @Environment(\.dismiss) private var dismiss
    @Environment(\.spacing) private var spacing
    @Environment(\.analytics) private var analytics
    @Environment(\.plan) private var planModel
    @Environment(\.purchases) private var purchases
    @State private var visit = AccountDeletionVisit()
    @State private var text = ""
    @State private var pending = false
    @State private var failure: String?
    @State private var managing = false

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

    /// What deleting does to each subscription still billing the account: the server cancels a
    /// web one, while only the buyer can cancel an App Store one.
    static func subscriptionLines(_ plan: Plan) -> [String] {
        plan.paidSources.compactMap { source in
            switch source {
            case .apple: appleSubscriptionLine
            case .stripe: stripeSubscriptionLine
            case .comp, .trial: nil
            }
        }
    }

    /// Warns that deleting asks Apple to confirm, for an account linked to Apple.
    static func appleLines(hasAppleSignIn: Bool) -> [String] {
        hasAppleSignIn ? [appleLine] : []
    }

    /// How an App Store subscriber reaches their subscription settings: the system sheet when
    /// the build has a purchase client, Apple's page otherwise. Nil for any other plan.
    enum AppStoreSettings: Equatable {
        case button
        case link(URL)
    }

    static func appStoreSettings(_ plan: Plan, hasClient: Bool) -> AppStoreSettings? {
        guard plan.paidSources.contains(.apple) else { return nil }
        return hasClient ? .button : .link(RevenueCatPurchases.appleSubscriptionsURL)
    }

    private static func countLine(_ count: Int, _ singular: String, _ plural: String) -> String? {
        guard count > 0 else { return nil }
        return "\(count) \(count == 1 ? singular : plural)"
    }

    /// The delete button's label: the action, then Apple's confirmation while its sheet is up,
    /// then the delete itself once it is sent.
    static func buttonLabel(pending: Bool, isConfirmingWithApple: Bool) -> String {
        guard pending else { return title }
        return isConfirmingWithApple ? confirmingWithApple : deleting
    }

    /// Delete waits out a loading count, so the list on screen never turns out to have been
    /// partial. An unavailable count does not hold it back, since the delete does not read the
    /// local store.
    public static func deleteEnabled(_ state: CountsState, text: String, pending: Bool) -> Bool {
        guard !pending, confirmationMatches(text) else { return false }
        if case .loading = state { return false }
        return true
    }

    /// The counts as one block of text, a line each, nil until they are known.
    static func countsBlock(_ state: CountsState) -> String? {
        let lines = listLines(state)
        return lines.isEmpty ? nil : lines.joined(separator: "\n")
    }

    #if os(macOS)
        /// The final confirm: filled danger, and never the default, so Return in the confirm
        /// field never deletes an account.
        static func macDelete(title: String, isEnabled: Bool, action: @escaping @MainActor () -> Void)
            -> MacSheetAction
        {
            MacSheetAction(title, role: .destructiveFilled, isEnabled: isEnabled, isDefault: false, action: action)
        }
    #endif

    public var body: some View {
        content
            .interactiveDismissDisabled(pending)
            .onAppear { visit.opened(analytics) }
            .onDisappear { visit.closed(analytics) }
    }

    #if os(macOS)
        private var content: some View {
            MacSheet(
                title: Self.heading, style: .danger, size: Self.macSize,
                cancel: .cancel(TuneFormSheet.cancel, isEnabled: !pending) { dismiss() },
                primary: Self.macDelete(
                    title: Self.buttonLabel(pending: pending, isConfirmingWithApple: session.isConfirmingWithApple),
                    isEnabled: Self.deleteEnabled(counts, text: text, pending: pending), action: runDelete)
            ) {
                VStack(alignment: .leading, spacing: MacForm.sectionGap) {
                    macWarning
                    macConfirm
                }
            }
            .shellSheet()
        }

        /// As tall as the warning and the confirm field, growing as the counts arrive; a longer
        /// warning scrolls.
        static let macSize = MacSheetSize.fittedOverSettings

        /// What is lost, as one block of text the musician reads top to bottom.
        private var macWarning: some View {
            VStack(alignment: .leading, spacing: 8) {
                Text(Self.lead)
                if let block = Self.countsBlock(counts) {
                    Text(block)
                        .monospacedDigit()
                        .padding(.leading, 12)
                }
                if Self.showsUnsyncedLine(counts) {
                    Text(Self.unsyncedLine)
                }
                let plan = planModel?.plan ?? .unknown
                ForEach(Self.subscriptionLines(plan), id: \.self) { Text($0) }
                switch Self.appStoreSettings(plan, hasClient: purchases != nil) {
                case .button:
                    Button(PlanText.manageAppStore) { manageSubscriptions() }
                        .buttonStyle(.macPlain)
                        .disabled(pending || managing)
                case .link(let url):
                    Link(PlanText.manageAppStore, destination: url)
                        .buttonStyle(.macPlain)
                case nil:
                    EmptyView()
                }
                Text("**\(Self.cannotUndo)**\(Self.noRecovery)")
            }
            .font(MacStyle.body)
            .foregroundStyle(Palette.ink)
            .fixedSize(horizontal: false, vertical: true)
        }

        private var macConfirm: some View {
            VStack(alignment: .leading, spacing: 6) {
                Text(Self.confirmLabel)
                    .font(MacStyle.label)
                    .foregroundStyle(Palette.ink)
                // The label above names the field, so it shows no prompt of its own.
                TextField(Self.confirmLabel, text: $text, prompt: Text(verbatim: ""))
                    .contentMask()
                    .labelsHidden()
                    .textFieldStyle(.macField)
                    .autocorrectionDisabled()
                    .disabled(pending)
                ForEach(Self.appleLines(hasAppleSignIn: session.hasAppleSignIn), id: \.self) {
                    Text($0)
                        .font(MacStyle.secondary)
                        .foregroundStyle(Palette.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let failure {
                    FailureText(failure)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    #else
        private var content: some View {
            NavigationStack {
                PaperForm {
                    Section {
                        VStack(spacing: spacing.stackGap) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.platform(.largeTitle, mac: .columnTitle))
                                .foregroundStyle(.red)
                                .accessibilityHidden(true)
                            Text(Self.heading)
                                .font(.platform(.headline))
                            Text(Self.lead)
                        }
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .listRowBackground(Color.clear)
                        ForEach(Self.listLines(counts), id: \.self) { Text($0) }
                        if Self.showsUnsyncedLine(counts) {
                            Text(Self.unsyncedLine)
                        }
                        let plan = planModel?.plan ?? .unknown
                        ForEach(Self.subscriptionLines(plan), id: \.self) { Text($0) }
                        switch Self.appStoreSettings(plan, hasClient: purchases != nil) {
                        case .button:
                            Button(PlanText.manageAppStore) { manageSubscriptions() }
                                .disabled(pending || managing)
                        case .link(let url):
                            Link(PlanText.manageAppStore, destination: url)
                        case nil:
                            EmptyView()
                        }
                        Text("**\(Self.cannotUndo)**\(Self.noRecovery)")
                    }
                    Section {
                        TextField(Self.confirmLabel, text: $text)
                            .contentMask()
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .disabled(pending)
                        ForEach(Self.appleLines(hasAppleSignIn: session.hasAppleSignIn), id: \.self) { Text($0) }
                        Button(role: .destructive) {
                            runDelete()
                        } label: {
                            Text(
                                Self.buttonLabel(pending: pending, isConfirmingWithApple: session.isConfirmingWithApple)
                            )
                        }
                        .disabled(!Self.deleteEnabled(counts, text: text, pending: pending))
                    } footer: {
                        if let failure {
                            Text(failure)
                                .foregroundStyle(.red)
                        }
                    }
                }
                .navigationTitle(Self.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(TuneFormSheet.cancel) { dismiss() }
                            .disabled(pending)
                    }
                }
            }
            .presentationDetents([.large])
            .shellSheet()
        }
    #endif

    private func manageSubscriptions() {
        managing = true
        Task {
            await purchases?.showManageSubscriptions()
            managing = false
        }
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
