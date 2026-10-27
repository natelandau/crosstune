import SwiftUI

/// A failed write's message, in red beside the control or above the rows it concerns.
package struct FailureText: View {
    package let message: String

    package init(_ message: String) {
        self.message = message
    }

    package var body: some View {
        Text(message)
            .font(.platform(.footnote))
            .foregroundStyle(Palette.danger)
    }
}
