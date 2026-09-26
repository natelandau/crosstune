import ClerkKit
import ClerkKitUI
import SwiftUI

/// Shown at sign-in after an account was deleted, until someone signs in again.
public enum DeletedNotice {
    public static let text = "Your account and all its data were deleted."
}

/// Clerk's sign-in and sign-up flow, with every method the instance enables.
public struct SignInView: View {
    let notice: String?

    public init(notice: String? = nil) {
        self.notice = notice
    }

    public var body: some View {
        VStack(spacing: 0) {
            if let notice {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
                    // A sighted reader sees this on screen at once; VoiceOver needs the same
                    // announced, since nothing here otherwise takes first-response focus.
                    .onAppear { AccessibilityNotification.Announcement(notice).post() }
            }
            AuthView(isDismissible: false)
                .environment(Clerk.shared)
        }
    }
}
