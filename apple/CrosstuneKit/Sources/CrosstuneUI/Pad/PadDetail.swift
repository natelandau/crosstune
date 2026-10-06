import CrosstuneStore
import CrosstuneSync
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

/// The Settings detail column's page, with a settings model of its own that reads the same
/// stored settings as the content column's.
struct SettingsDetail: View {
    let page: SettingsPage?

    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.store) private var store
    @State private var model: SettingsModel?

    var body: some View {
        Group {
            if let page {
                SettingsPageScreen(page: page, model: model)
            } else {
                SettingsDetailPlaceholder()
            }
        }
        .task(id: ModelKey(store: store, engine: engine)) {
            model = store.map { SettingsModel(store: $0, engine: engine) }
        }
    }
}
