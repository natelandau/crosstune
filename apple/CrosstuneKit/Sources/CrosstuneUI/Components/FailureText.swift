import SwiftUI

/// A failed write's message, in red beside the control or above the rows it concerns.
struct FailureText: View {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(.red)
    }
}
