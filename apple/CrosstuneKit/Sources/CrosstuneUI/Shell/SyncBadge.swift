import CrosstuneAuth
import CrosstuneSync
import SwiftUI

/// The sync state, shown only when it needs attention: `Update required`, `Offline`, `Sign in
/// again`, or `Sync failed`. A clean or running sync says nothing; Settings holds the full state.
public struct SyncBadge: View {
    private let status: SyncStatus

    /// The status to show, or nil when nothing needs attention.
    ///
    /// A required update wins, since only updating the app ends it, and it reads as offline.
    /// Offline comes next, because every run ends offline without a request while the app
    /// cannot reach the servers. A session the API refused needs a new sign-in whatever the
    /// last run said.
    nonisolated public static func attention(
        status: SyncStatus?, isOffline: Bool, needsSignIn: Bool, updateRequired: Bool
    ) -> SyncStatus? {
        if updateRequired { return .updateRequired }
        if isOffline { return .offline }
        if needsSignIn { return .unauthorized }
        switch status {
        case .offline, .unauthorized, .error, .updateRequired: return status
        case .idle, .syncing, nil: return nil
        }
    }

    public init(status: SyncStatus) {
        self.status = status
    }

    public var body: some View {
        let swatch = Self.swatch(status, scheme: colorScheme)
        Text(status.label)
            .font(.platform(.footnote).weight(.semibold))
            .foregroundStyle(swatch.ink.color)
            .padding(.horizontal, spacing(10))
            .padding(.vertical, spacing(4))
            .background(swatch.background.color, in: .capsule)
            .fixedSize()
    }

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.spacing) private var spacing

    /// A warning while offline, which fixes itself, and while an update is required, which the
    /// store does for the musician; danger when the musician has to act.
    nonisolated static func swatch(_ status: SyncStatus, scheme: ColorScheme) -> KeyColor.Swatch {
        status == .offline || status == .updateRequired ? SignalSwatch.warning(scheme) : SignalSwatch.danger(scheme)
    }
}

extension View {
    /// Adds the sync badge to this screen's toolbar, reading the session and engine from the
    /// environment. Nothing is added while sync needs no attention. `leading` puts it at the
    /// bar's leading edge on iPhone, for a screen whose two buttons fill the trailing edge. A
    /// leading badge hides while the screen is selecting, whose Select All takes that edge.
    /// `isShown` false leaves the badge out, as where another place shows it.
    func syncBadgeToolbar(leading: Bool = false, isShown: Bool = true) -> some View {
        toolbar {
            if isShown {
                ToolbarItem(placement: Self.badgePlacement(leading: leading)) {
                    SyncBadgeItem(hidesWhileSelecting: leading)
                }
                .sharedBackgroundVisibility(.hidden)
            }
        }
    }

    private static func badgePlacement(leading: Bool) -> ToolbarItemPlacement {
        #if os(macOS)
            .status
        #else
            leading ? .topBarLeading : .topBarTrailing
        #endif
    }
}

/// The sync badge for the session and engine in the environment, or nothing while sync needs
/// no attention. While an update is required, the badge reopens the prompt to update.
struct SyncBadgeItem: View {
    let hidesWhileSelecting: Bool

    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.selecting) private var selecting
    @Environment(\.askForUpdate) private var askForUpdate

    var body: some View {
        let shown = SyncBadge.attention(
            status: engine?.status, isOffline: session?.isOffline ?? false, needsSignIn: session?.needsSignIn ?? false,
            updateRequired: session?.updateRequired ?? false)
        if let shown, !(hidesWhileSelecting && selecting?.isCovered == true) {
            if shown == .updateRequired, let session {
                Button {
                    if let askForUpdate { askForUpdate() } else { session.showUpdatePrompt() }
                } label: {
                    SyncBadge(status: shown)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(shown.label)
            } else {
                SyncBadge(status: shown)
            }
        }
    }
}
