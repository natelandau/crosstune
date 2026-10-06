import CrosstuneAuth
import CrosstuneExport
import CrosstuneUI
import SwiftUI

@main
struct CrosstuneApp: App {
    @State private var session: AccountSession
    @State private var player: PlayerModel
    @State private var listPlayback: ListPlayback
    @State private var stage = EmbedStage()
    @State private var recorders = RecorderHost()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Before any window can start an export, so only zips a past run left behind go.
        ExportArchive.removeLeftovers()
        ScanViewer.moveLegacyInvert()
        let player = PlayerModel.device()
        _player = State(initialValue: player)
        _listPlayback = State(initialValue: ListPlayback.device(player: player))
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
                .followsDisplaySettings()
                .tint(BrandStyle.accent)
        }
        .commands {
            SidebarCommands()
            AppCommands()
        }
        .onChange(of: scenePhase, initial: true) {
            session.sceneActivityChanged(isActive: scenePhase == .active)
            if scenePhase == .background { player.leftForeground() }
        }

        #if os(macOS)
            Settings {
                settings
                    .environment(\.store, session.store)
                    .environment(session.syncEngine)
                    .environment(session)
                    .environment(player)
                    .followsDisplaySettings()
                    .tint(BrandStyle.accent)
            }
        #endif
    }

    #if os(macOS)
        @ViewBuilder private var settings: some View {
            #if DEBUG
                if CommandLine.arguments.contains("-SampleShell") {
                    SampleSettings()
                } else {
                    MacSettingsTabs()
                }
            #else
                MacSettingsTabs()
            #endif
        }
    #endif

    @ViewBuilder private var content: some View {
        #if DEBUG
            // Shows the shell over the marketing site's fixture, named by the argument after the flag.
            if let flag = CommandLine.arguments.firstIndex(of: "-MarketingShell"),
                CommandLine.arguments.indices.contains(flag + 1)
            {
                MarketingShell(fixture: URL(filePath: CommandLine.arguments[flag + 1]))
            } else if CommandLine.arguments.contains("-SampleShell") {
                // Shows the shell over sample data without signing in, for screenshots.
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
        RootView(session: session, player: player, listPlayback: listPlayback, stage: stage, recorders: recorders)
    }
}
