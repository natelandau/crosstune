import SwiftUI

/// The screen for a destination, the one place a destination turns into a view.
struct DestinationScreen: View {
    let destination: Destination
    /// The compact tab bar's Settings is a root of pages; the sidebar's keeps the one form.
    var usesSettingsRoot = false

    var body: some View {
        switch destination {
        case .catalog: CatalogScreen()
        case .lists: ListsScreen()
        case .recordings: RecordingsScreen()
        case .settings:
            if usesSettingsRoot { SettingsRoot() } else { SettingsScreen() }
        }
    }
}
