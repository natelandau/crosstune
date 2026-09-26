import CrosstuneAuth
import CrosstuneUI
import SwiftUI

@main
struct CrosstuneApp: App {
    @State private var session: AccountSession
    @State private var player = PlayerModel()
    @State private var stage = EmbedStage()
    @State private var recorders = RecorderHost()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let configuration = AppConfiguration.main
        _session = State(
            initialValue: AccountSession(
                publishableKey: configuration.clerkPublishableKey,
                apiOrigin: configuration.apiOrigin,
                clientVersion: configuration.clientVersion,
                storageOrigin: configuration.storageOrigin
            ))
    }

    var body: some Scene {
        WindowGroup(id: AppCommands.mainWindow) {
            content
                .followsAppearanceSetting()
        }
        .commands {
            AppCommands()
        }
        .onChange(of: scenePhase, initial: true) {
            session.sceneActivityChanged(isActive: scenePhase == .active)
        }

        #if os(macOS)
            Settings {
                NavigationStack {
                    SettingsScreen()
                }
                // The window is not resizable and sizes to its content's ideal, and a scrolling
                // form has almost none, so the ideal is what keeps several sections in view.
                .frame(minWidth: 460, idealWidth: 520, minHeight: 480, idealHeight: 640)
                .environment(\.store, session.store)
                .environment(session.syncEngine)
                .environment(session)
                .followsAppearanceSetting()
            }
        #endif
    }

    @ViewBuilder private var content: some View {
        #if DEBUG
            // Shows the shell over sample data without signing in, for screenshots.
            if CommandLine.arguments.contains("-SampleShell") {
                SampleShell(
                    playing: CommandLine.arguments.contains("-SamplePlaying"),
                    playingRecording: CommandLine.arguments.contains("-SamplePlayingRecording"))
            } else {
                root
            }
        #else
            root
        #endif
    }

    private var root: some View {
        RootView(session: session, player: player, stage: stage, recorders: recorders)
    }
}
