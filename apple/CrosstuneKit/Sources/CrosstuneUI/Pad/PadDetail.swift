import SwiftUI

/// The detail column: what the tab's path shows there.
struct PadDetail: View {
    let detail: DetailPage
    /// Closes the recording page, back to the tune under it.
    let onCloseRecording: @MainActor () -> Void

    var body: some View {
        switch detail {
        case .recording(let recordingID):
            RecordingPage(
                recordingID: recordingID, parent: RecordingPageParent(showsClose: true, leave: onCloseRecording))
        case .tune(let tuneID):
            TuneScreen(tuneID: tuneID)
        case .placeholder:
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
