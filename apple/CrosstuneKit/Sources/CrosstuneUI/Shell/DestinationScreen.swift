import SwiftUI

/// The screen for a destination, the one place a destination turns into a view.
struct DestinationScreen: View {
    let destination: Destination

    var body: some View {
        switch destination {
        case .catalog: CatalogScreen()
        case .lists: ListsScreen()
        case .recordings: RecordingsScreen()
        case .settings: SettingsScreen()
        }
    }
}
