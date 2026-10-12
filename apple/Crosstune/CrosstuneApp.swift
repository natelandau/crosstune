import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneBilling
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
    /// The open store's plan, made again for each store so another account starts unknown.
    @State private var plan: PlanModel?
    /// Which window shows the plan notices, made again with each store's plan.
    @State private var noticeClaim: NoticeClaim?
    private let analytics: AnalyticsClient
    /// Nil in a build with no RevenueCat key, which offers no purchase.
    private let purchases: (any PurchaseClient)?
    private let stripePortalURL: URL?
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let configuration = AppConfiguration.main
        // First, with the stored choice applied, so the SDK is set up before the session below
        // identifies its user, or never when sharing is off.
        let analytics =
            configuration.postHogHost.map { Analytics.start(token: configuration.postHogToken, host: $0) } ?? .noop
        UsageData.launch(analytics)
        self.analytics = analytics
        purchases = configuration.revenueCatAPIKey.map { RevenueCatPurchases(apiKey: $0) }
        stripePortalURL = configuration.stripePortalURL
        // Before any window can start an export, so only zips a past run left behind go.
        ExportArchive.removeLeftovers()
        let player = PlayerModel.device(analytics: analytics)
        _player = State(initialValue: player)
        _listPlayback = State(initialValue: ListPlayback.device(player: player, analytics: analytics))
        _session = State(
            initialValue: AccountSession(
                publishableKey: configuration.clerkPublishableKey,
                apiOrigin: configuration.apiOrigin,
                clientVersion: configuration.clientVersion,
                storageOrigin: configuration.storageOrigin,
                analytics: analytics,
                deviceSettings: { DeviceSettings.current() },
                assistiveTech: { AssistiveTech.current() }
            ))
    }

    var body: some Scene {
        WindowGroup(id: AppCommands.mainWindow) {
            content
                .environment(\.analytics, analytics)
                .environment(\.plan, plan)
                .environment(\.noticeClaim, noticeClaim)
                .environment(\.purchases, purchases)
                .environment(\.stripePortalURL, stripePortalURL)
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
            // A trial may have ended while the app was away.
            if scenePhase == .active { plan?.judgeAgain() }
        }
        .onChange(of: session.store?.userID, initial: true) {
            let bound = StorePlan.bind(session.store, player: player, purchases: purchases)
            plan = bound.plan
            noticeClaim = bound.noticeClaim
        }

        #if os(macOS)
            Settings {
                settings
                    .environment(\.analytics, analytics)
                    .environment(\.plan, plan)
                    .environment(\.purchases, purchases)
                    .environment(\.stripePortalURL, stripePortalURL)
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
                    SampleSettings(plan: SamplePlan.fromArguments())
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
                    playingRecording: CommandLine.arguments.contains("-SamplePlayingRecording"),
                    plan: SamplePlan.fromArguments())
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
