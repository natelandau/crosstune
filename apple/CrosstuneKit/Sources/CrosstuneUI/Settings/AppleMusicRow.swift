import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneDesign
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// Words the Apple Music settings row shows.
public enum AppleMusicText {
    public static let title = "Apple Music"
    public static let fullTracks = "Full tracks"
    public static let previews = "Previews"
    public static let help = "Plays Apple Music recordings in full on this device with your subscription."
    public static let askHint = "Asks for access to Apple Music."
    public static let settingsHint = "Opens Settings, where you can allow Apple Music."

    static func value(_ state: AppleMusicAccessState) -> String {
        state == .fullTracks ? fullTracks : previews
    }
}

/// What a tap on the Apple Music row does.
enum AppleMusicRowAction: Equatable {
    /// Shows the system's prompt for access.
    case request
    /// Opens the system's settings, the only place a declined access can change.
    case openSystemSettings
    /// Nothing here can change it.
    case none

    static func make(_ state: AppleMusicAccessState) -> Self {
        switch state {
        case .notAsked: .request
        case .declined: .openSystemSettings
        case .fullTracks, .noSubscription: .none
        }
    }

    /// What VoiceOver says a tap does, nil for a row that does nothing.
    var hint: String? {
        switch self {
        case .request: AppleMusicText.askHint
        case .openSystemSettings: AppleMusicText.settingsHint
        case .none: nil
        }
    }

    /// Where the system lets a person allow access again.
    static var systemSettingsURL: URL? {
        #if os(iOS)
            URL(string: UIApplication.openSettingsURLString)
        #else
            URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Media")
        #endif
    }
}

/// Whether this device plays Apple Music recordings in full. Access belongs to the device's
/// Apple Account, so it never syncs and is read again whenever the app comes back to the front.
struct AppleMusicSection: View {
    let access: any AppleMusicAccess

    @State private var state: AppleMusicAccessState?
    @Environment(\.openURL) private var openURL
    @Environment(\.analytics) private var analytics
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        content
            .task { state = await access.current() }
            .onChange(of: scenePhase) {
                guard scenePhase == .active else { return }
                Task { state = await access.current() }
            }
    }

    @ViewBuilder private var content: some View {
        #if os(macOS)
            if let state {
                MacFormSection {
                    macRow(state)
                }
            } else {
                // Holds the place while access is read, so the task above has a view to run on.
                Color.clear.frame(width: 0, height: 0)
            }
        #else
            Section {
                if let state {
                    row(state)
                }
            } header: {
                SettingsHelp(AppleMusicText.help)
            }
        #endif
    }

    #if os(macOS)
        private func performing(_ action: AppleMusicRowAction) -> () -> Void {
            { perform(action) }
        }

        @ViewBuilder private func macRow(_ state: AppleMusicAccessState) -> some View {
            let action = AppleMusicRowAction.make(state)
            if action == .none {
                MacSettingsRow(AppleMusicText.title, help: AppleMusicText.help) {
                    MacSettingsValue(AppleMusicText.value(state))
                }
            } else {
                MacSettingsLinkRow(value: AppleMusicText.value(state), hint: action.hint, action: performing(action)) {
                    Text(AppleMusicText.title)
                    Text(AppleMusicText.help)
                }
            }
        }
    #endif

    #if !os(macOS)
        @ViewBuilder private func row(_ state: AppleMusicAccessState) -> some View {
            let action = AppleMusicRowAction.make(state)
            if action == .none {
                LabeledContent(AppleMusicText.title, value: AppleMusicText.value(state))
            } else {
                SettingsFieldRow(title: AppleMusicText.title, value: AppleMusicText.value(state), hint: action.hint) {
                    perform(action)
                }
            }
        }
    #endif

    private func perform(_ action: AppleMusicRowAction) {
        switch action {
        case .request:
            Task {
                let answer = await access.request()
                state = answer
                analytics.appleMusicAnswered(answer)
            }
        case .openSystemSettings:
            if let url = AppleMusicRowAction.systemSettingsURL { openURL(url) }
        case .none:
            break
        }
    }
}
