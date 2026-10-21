import CrosstuneAudio
import SwiftUI

/// The words that say location access is off and lead to where it turns back on.
public enum LocationAccessText {
    public static let off = "Location access is off, so new takes don’t save where they were made."
    public static let openSettings = "Open Settings"
}

/// Says that location access is off, with Open Settings, while it is. A form's help sits in
/// its footer and a settings group's above its rows, so `helpAbove` picks which.
struct LocationAccessSection: View {
    var helpAbove = false

    @Environment(\.locationAccess) private var access
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let access, access.isOff, let url = LocationAccess.settingsURL {
            if helpAbove {
                Section {
                    openSettings(url)
                } header: {
                    SettingsHelp(LocationAccessText.off)
                }
            } else {
                Section {
                    openSettings(url)
                } footer: {
                    Text(LocationAccessText.off)
                }
            }
        }
    }

    private func openSettings(_ url: URL) -> some View {
        Button(LocationAccessText.openSettings) { openURL(url) }
    }
}
