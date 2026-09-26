import CrosstuneAuth
import CrosstuneSync
import SwiftUI

/// The sync state, shown only when it needs attention: `Offline`, `Sign in again`, or `Sync
/// failed`. A clean or running sync says nothing; Settings holds the full state.
public struct SyncBadge: View {
    private let status: SyncStatus

    /// The status to show, or nil when nothing needs attention.
    ///
    /// Offline wins, because every run ends offline without a request while the app cannot
    /// reach the servers. A session the API refused needs a new sign-in whatever the last run
    /// said.
    nonisolated public static func attention(status: SyncStatus?, isOffline: Bool, needsSignIn: Bool) -> SyncStatus? {
        if isOffline { return .offline }
        if needsSignIn { return .unauthorized }
        switch status {
        case .offline, .unauthorized, .error: return status
        case .idle, .syncing, nil: return nil
        }
    }

    public init(status: SyncStatus) {
        self.status = status
    }

    public var body: some View {
        let swatch = Self.swatch(status, scheme: colorScheme)
        Text(status.label)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(swatch.ink.color)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(swatch.background.color, in: .capsule)
            .fixedSize()
    }

    @Environment(\.colorScheme) private var colorScheme

    /// A warning while offline, which fixes itself; danger when the musician has to act. The
    /// text is a deep shade on a pale fill in light mode and the reverse in dark mode, so it
    /// keeps at least 4.5:1 contrast with its capsule.
    nonisolated static func swatch(_ status: SyncStatus, scheme: ColorScheme) -> KeyColor.Swatch {
        let warning = status == .offline
        switch (scheme == .dark, warning) {
        case (false, true): return Self.swatch(background: 0xFFEFD9, ink: 0x8A4B00)
        case (false, false): return Self.swatch(background: 0xFDE2E0, ink: 0xB3261E)
        case (true, true): return Self.swatch(background: 0x3D2A12, ink: 0xFFB35C)
        case (true, false): return Self.swatch(background: 0x4A1C1A, ink: 0xFF8A80)
        }
    }

    nonisolated private static func swatch(background: Int, ink: Int) -> KeyColor.Swatch {
        func rgb(_ hex: Int) -> KeyColor.RGB {
            KeyColor.RGB(
                red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255,
                blue: Double(hex & 0xFF) / 255)
        }
        return KeyColor.Swatch(background: rgb(background), ink: rgb(ink))
    }
}

extension View {
    /// Adds the sync badge to this screen's toolbar, reading the session and engine from the
    /// environment. Nothing is added while sync needs no attention.
    func syncBadgeToolbar() -> some View {
        toolbar {
            ToolbarItem(placement: Self.badgePlacement) {
                SyncBadgeItem()
            }
            .sharedBackgroundVisibility(.hidden)
        }
    }

    private static var badgePlacement: ToolbarItemPlacement {
        #if os(macOS)
            .status
        #else
            .topBarTrailing
        #endif
    }
}

private struct SyncBadgeItem: View {
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(SyncEngine.self) private var engine: SyncEngine?

    var body: some View {
        let shown = SyncBadge.attention(
            status: engine?.status, isOffline: session?.isOffline ?? false, needsSignIn: session?.needsSignIn ?? false)
        if let shown {
            SyncBadge(status: shown)
        }
    }
}
