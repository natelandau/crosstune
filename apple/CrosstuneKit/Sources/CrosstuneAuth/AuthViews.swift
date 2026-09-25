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

/// Clerk's profile view: the account's email and sign-in methods, sign-out, and deletion.
public struct AccountView: View {
    public init() {}

    public var body: some View {
        UserProfileView(isDismissible: true)
            .environment(Clerk.shared)
    }
}
