import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneAuth
import CrosstuneBilling
import CrosstuneDesign
import CrosstuneDiagnostics
import CrosstuneExport
import CrosstuneRecording
import CrosstuneUI
import SwiftUI

@main
struct CrosstuneApp: App {
    #if os(macOS)
        @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif
    @State private var session: AccountSession
    @State private var player: PlayerModel
    @State private var listPlayback: ListPlayback
    @State private var stage = EmbedStage()
    @State private var recorders: RecorderHost
    /// One for the app, so two windows on the Tuner share one microphone session.
    @State private var tuner: TunerModel
    @State private var locationAccess = LocationAccess()
    /// The open store's plan, made again for each store so another account starts unknown.
    @State private var plan: PlanModel?
    /// Which window shows the plan notices, made again with each store's plan.
    @State private var noticeClaim: NoticeClaim?
    @State private var reviewPrompt: ReviewPrompt
    /// Which window shows the update prompt.
    @State private var updatePromptClaim = UpdatePromptClaim()
    private let analytics: AnalyticsClient
    private let diagnostics: DiagnosticsClient
    /// Nil in a build with no RevenueCat key, which offers no purchase.
    private let purchases: (any PurchaseClient)?
    private let stripePortalURL: URL?
    private let appStoreURL: URL?
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Read apart from `AppConfiguration`, so a configuration error that traps is reported.
        let diagnostics = Diagnostics.start(dsn: Bundle.main.object(forInfoDictionaryKey: "SentryDSN") as? String)
        self.diagnostics = diagnostics
        let configuration = AppConfiguration.main
        let reviewPrompt = ReviewPrompt()
        let recorders = RecorderHost(makeLocation: { DeviceLocationProvider() })
        _recorders = State(initialValue: recorders)
        _tuner = State(initialValue: TunerModel(input: TunerInput(), recorders: recorders))
        _reviewPrompt = State(initialValue: reviewPrompt)
        // With a stored choice, the SDK is set up now (or never, when sharing is off). With none,
        // setup waits for the region default and the remembered user is applied then.
        let analytics =
            (configuration.postHogHost.map { Analytics.start(token: configuration.postHogToken, host: $0) }
            ?? .noop)
            .observing(reviewPrompt.observer)
        let apiOrigin = configuration.apiOrigin
        UsageData.launch(analytics, region: { try await Region.fetch(origin: apiOrigin) })
        self.analytics = analytics
        purchases = configuration.revenueCatAPIKey.map { RevenueCatPurchases(apiKey: $0, diagnostics: diagnostics) }
        stripePortalURL = configuration.stripePortalURL
        appStoreURL = UpdatePromptText.appStoreURL(id: configuration.appStoreID)
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
                diagnostics: diagnostics,
                deviceSettings: { DeviceSettings.current() },
                assistiveTech: { AssistiveTech.current() },
                // A capture a crash or kill cut short is saved now rather than waiting on the user.
                storeOpened: { await Recorder.recoverLeftoverCaptures(in: $0) }
            ))
    }

    var body: some Scene {
        WindowGroup(id: AppCommands.mainWindow) {
            content
                .environment(\.analytics, analytics)
                .environment(\.diagnostics, diagnostics)
                .environment(\.plan, plan)
                .environment(\.noticeClaim, noticeClaim)
                .environment(\.reviewPrompt, reviewPrompt)
                .environment(\.updatePromptClaim, updatePromptClaim)
                .environment(\.purchases, purchases)
                .environment(\.stripePortalURL, stripePortalURL)
                .environment(\.appStoreURL, appStoreURL)
                .environment(\.placeSearch, MapKitPlaceSearch.self)
                .environment(\.nearbySearch, MapKitNearbySearch.self)
                .environment(\.locationAccess, locationAccess)
                .followsDisplaySettings()
                .tint(appTint)
        }
        .commands {
            SidebarCommands()
            AppCommands()
        }
        .onChange(of: scenePhase, initial: true) {
            session.sceneActivityChanged(isActive: scenePhase == .active)
            if scenePhase == .background {
                player.leftForeground()
                reviewPrompt.leftForeground()
            }
            if scenePhase == .active {
                // A trial may have ended while the app was away.
                plan?.judgeAgain()
                reviewPrompt.opened()
            }
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
                    .environment(\.diagnostics, diagnostics)
                    .environment(\.plan, plan)
                    .environment(\.purchases, purchases)
                    .environment(\.stripePortalURL, stripePortalURL)
                    .environment(\.store, session.store)
                    .environment(\.locationAccess, locationAccess)
                    .environment(session.syncEngine)
                    .environment(session)
                    .environment(player)
                    .followsDisplaySettings()
                    .tint(appTint)
            }
        #endif
    }

    private var appTint: Color { Palette.accent }

    #if os(macOS)
        @ViewBuilder private var settings: some View {
            #if DEBUG
                if CommandLine.arguments.contains("-SampleShell") {
                    SampleSettings(plan: SamplePlan.fromArguments(), screen: SampleScreen.fromArguments())
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
                // Shows the shell over sample data without signing in, for screenshots, opened on the
                // surface `-SampleScreen` names.
                SampleShell(
                    playing: CommandLine.arguments.contains("-SamplePlaying"),
                    playingRecording: CommandLine.arguments.contains("-SamplePlayingRecording"),
                    plan: SamplePlan.fromArguments(), screen: SampleScreen.fromArguments())
            } else {
                root
            }
        #else
            root
        #endif
    }

    private var root: some View {
        RootView(
            session: session, player: player, listPlayback: listPlayback, stage: stage, recorders: recorders,
            tuner: tuner)
    }
}

#if os(macOS)
    final class AppDelegate: NSObject, NSApplicationDelegate {
        /// A new-tune draft with a title makes its tune before the app quits, as closing its
        /// window does.
        func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
            OpenDrafts.shared.holdsQuit { sender.reply(toApplicationShouldTerminate: true) }
                ? .terminateLater : .terminateNow
        }
    }
#endif
