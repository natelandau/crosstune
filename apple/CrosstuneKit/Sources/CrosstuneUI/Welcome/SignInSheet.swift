import CrosstuneAuth
import SwiftUI

/// Clerk's sign-in flow in a sheet over the welcome screen.
struct SignInSheet: View {
    var body: some View {
        SignInView(notice: nil, isDismissible: true)
            .shellSheet()
    }
}
