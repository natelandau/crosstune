import SwiftUI

/// The detail column: the tab's tune page, or its placeholder.
struct PadDetail: View {
    let tuneID: String?

    init(tuneID: String?) {
        self.tuneID = tuneID
    }

    var body: some View {
        if let tuneID {
            TuneScreen(tuneID: tuneID)
        } else {
            TuneDetailPlaceholder()
        }
    }
}

/// The Settings detail column while no category is chosen.
struct SettingsDetailPlaceholder: View {
    static let title = "No setting selected"

    var body: some View {
        ContentUnavailableView(Self.title, systemImage: Destination.settings.systemImage)
    }
}

/// The Settings detail column's page.
struct SettingsDetail: View {
    let page: SettingsPage?

    var body: some View {
        if let page {
            SettingsPageScreen(page: page)
        } else {
            SettingsDetailPlaceholder()
        }
    }
}
