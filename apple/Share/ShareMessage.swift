import CrosstunePalette
import SwiftUI

/// A sheet state that is only a message, such as a saved share or a sign-in prompt.
struct ShareMessage: View {
    let text: String

    var body: some View {
        // Scrolls so a long message at a large text size is never cut off in a short window.
        ScrollView {
            Text(text)
                .foregroundStyle(Palette.textPrimary)
                .multilineTextAlignment(.center)
                .padding()
                .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.center, for: .alignment)
        .scrollBounceBehavior(.basedOnSize)
        .background(Palette.groupedBackground)
    }
}
