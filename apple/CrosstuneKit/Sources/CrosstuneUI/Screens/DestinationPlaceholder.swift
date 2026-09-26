import SwiftUI

/// A screen's stand-in until it is built: its title and symbol, centered.
struct DestinationPlaceholder: View {
    let title: String
    let systemImage: String

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage)
            .navigationTitle(title)
    }
}
