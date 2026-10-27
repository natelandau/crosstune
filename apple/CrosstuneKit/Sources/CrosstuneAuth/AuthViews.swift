import ClerkKit
import ClerkKitUI
import SwiftUI

/// Shown at sign-in after an account was deleted, until someone signs in again.
public enum DeletedNotice {
    public static let text = "Your account and all its data were deleted."
}

/// Which of Clerk's flows ``SignInView`` opens on.
public enum AuthMode: Sendable, Hashable, Identifiable {
    /// Sign in, with a way to create an account from there.
    case signIn
    /// Create an account.
    case signUp

    public var id: Self { self }

    var clerkMode: AuthView.Mode {
        switch self {
        case .signIn: .signInOrUp
        case .signUp: .signUp
        }
    }
}

/// Clerk's sign-in and sign-up flow, with every method the instance enables.
public struct SignInView: View {
    let notice: String?
    let isDismissible: Bool
    let mode: AuthMode
    let palette: AuthPalette?

    /// A dismissible view shows Clerk's close button and closes itself once someone signs in,
    /// for a sheet; a view that fills the window has no way out but signing in. Without a
    /// `palette`, Clerk draws its own theme.
    public init(
        notice: String? = nil, isDismissible: Bool = false, mode: AuthMode = .signIn, palette: AuthPalette? = nil
    ) {
        self.notice = notice
        self.isDismissible = isDismissible
        self.mode = mode
        self.palette = palette
    }

    public var body: some View {
        VStack(spacing: 0) {
            if let notice {
                Text(notice)
                    .font(palette?.noticeFont ?? .footnote)
                    .foregroundStyle(palette.map { AnyShapeStyle($0.textSecondary) } ?? AnyShapeStyle(.secondary))
                    .multilineTextAlignment(.center)
                    .padding()
                    // A sighted reader sees this on screen at once; VoiceOver needs the same
                    // announced, since nothing here otherwise takes first-response focus.
                    .onAppear { AccessibilityNotification.Announcement(notice).post() }
            }
            AuthView(mode: mode.clerkMode, isDismissible: isDismissible)
                #if os(macOS)
                    // The default style draws AppKit's white bezel inside Clerk's own field.
                    .textFieldStyle(.plain)
                #endif
                .environment(Clerk.shared)
                .transformEnvironment(\.clerkTheme) { theme in
                    if let palette { theme = .crosstune(palette) }
                }
        }
    }
}
