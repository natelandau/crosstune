import CrosstuneAuth
import SwiftUI

/// Clerk's sign-in or sign-up flow in a sheet over the welcome screen.
struct SignInSheet: View {
    let mode: AuthMode

    var body: some View {
        SignInView(notice: nil, isDismissible: true, mode: mode)
            .shellSheet()
    }
}
