#if DEBUG
    import SwiftUI

    /// A surface the sample shell opens at launch, named by `-SampleScreen <name>` beside
    /// `-SampleShell`. A window captured in the background takes no clicks, so each surface is
    /// reached by setting the state its own button would set. Debug builds only.
    public enum SampleScreen: String, CaseIterable, Sendable {
        case catalog
        case recordings
        case list
        case tune
        /// An archived tune with few sections: no recordings, scans, lyrics, or lists.
        case tuneArchived = "tune-archived"
        case practice
        case emptyCatalog = "empty-catalog"
        case tuneNew = "tune-new"
        case tuneEdit = "tune-edit"
        case deleteTune = "delete-tune"
        case catalogFilters = "catalog-filters"
        /// The catalog with a key and two sheet filters set, as the row and search field show them.
        case catalogSetFilters = "catalog-set-filters"
        case keyFilter = "key-filter"
        case bulkEdit = "bulk-edit"
        /// A list selecting two of its tunes, with no sheet over it.
        case listSelecting = "list-selecting"
        case undoBanner = "undo-banner"
        case recordingsFilters = "recordings-filters"
        /// Recordings narrowed to the musician's own, so the screen shows its Filters controls.
        case recordingsSetFilters = "recordings-set-filters"
        case record
        case listNew = "list-new"
        case listPicker = "list-picker"
        case tunePicker = "tune-picker"
        case link
        case findRecordings = "find-recordings"
        case lyrics
        case scans
        case plan
        case planMember = "plan-member"
        case noticeFirstRecording = "notice-first-recording"
        case noticeTrialReminder = "notice-trial-reminder"
        case noticeTrialEnded = "notice-trial-ended"
        case updatePrompt = "update-prompt"
        case importTunes = "import"
        case export
        case deleteAccount = "delete-account"
        /// The music services sheet: over the Mac Settings window's Tunes tab, and over Find
        /// recordings on iPhone and iPad.
        case musicServices = "music-services"
        case stats
        /// The first saved location: its sheet over the Mac Settings window's Recordings tab, and
        /// its page in Settings on iPhone and iPad.
        case savedLocations = "saved-locations"
        case welcome
        case signIn = "signin"
        /// Every library control in every state, in place of the shell.
        case controls

        /// The screen named after `-SampleScreen` in the launch arguments, nil without one.
        public static func fromArguments(_ arguments: [String] = CommandLine.arguments) -> SampleScreen? {
            guard let flag = arguments.firstIndex(of: "-SampleScreen"), arguments.indices.contains(flag + 1) else {
                return nil
            }
            return SampleScreen(rawValue: arguments[flag + 1])
        }

        /// The tune most screens open in the detail column: the sample's fullest, with lyrics,
        /// links, a recording, and scans.
        static var tuneID: String { SampleCatalog.entries[0].tune.id }
        static var archivedTuneID: String {
            SampleCatalog.entries.first { $0.userTune.archivedAt != nil }?.tune.id ?? tuneID
        }
        static var listID: String { SampleCatalog.lists[0].id }

        /// Shows the signed-out welcome screen in place of the shell.
        var isSignedOut: Bool { self == .welcome || self == .signIn }

        /// Shows a surface of its own in place of the shell, with no sample store.
        var replacesShell: Bool { isSignedOut || self == .controls }

        /// Opens a store with no tunes, lists, or recordings.
        var isEmpty: Bool { self == .emptyCatalog }

        /// Where the shell opens: on the Mac, the sidebar row and the detail column's tune; on
        /// iPhone and iPad, the tab, its list, and its tune.
        @MainActor func place() -> ShellPlace {
            let place = ShellPlace()
            place.restoresTab = false
            switch self {
            case .recordings, .recordingsFilters, .recordingsSetFilters:
                place.sidebar = .recordings
                place.tab = .recordings
            case .list, .listSelecting, .tunePicker:
                place.sidebar = .list(id: Self.listID)
                place.tab = .lists
                place.tabList = Self.listID
            default: break
            }
            let tuneID = self == .tuneArchived ? Self.archivedTuneID : Self.tuneID
            if !isEmpty { place.detailPath.tune = tuneID }
            // On iPhone a tune covers the tab's own screen, so only a screen shown from a tune opens one.
            if opensFromTune { place.tabPaths[place.tab, default: PagePath()].tune = tuneID }
            return place
        }

        /// Shown from a tune's screen, so iPhone and iPad must open that tune first.
        private var opensFromTune: Bool {
            switch self {
            case .tune, .tuneArchived, .tuneEdit, .deleteTune, .findRecordings, .link, .listPicker, .lyrics, .scans,
                .musicServices:
                true
            default: false
            }
        }

        /// Whether the screen opens Find recordings over the tune first: the way to the music
        /// services sheet on iPhone and iPad. The Mac opens that sheet from its Settings window.
        static var musicServicesFromFindRecordings: Bool {
            #if os(macOS)
                false
            #else
                true
            #endif
        }

        /// The plan a screen needs to show, used when no `-SamplePlan` names one.
        var plan: SamplePlan? {
            switch self {
            case .plan: .free
            case .planMember: .premium
            case .noticeFirstRecording: .trialEarly
            case .noticeTrialReminder: .trial
            case .noticeTrialEnded: .trialEnded
            default: nil
            }
        }
    }

    extension EnvironmentValues {
        /// The surface the launch asked for. Supplied by the sample shell and sample settings.
        @Entry var sampleScreen: SampleScreen?
    }

    extension View {
        /// Runs `open` once per launch, when the launch asked for `screen` and `isReady` first
        /// holds, after a pause that lets the shell settle so a sheet is never refused for
        /// another presentation still under way. A screen reached through another surface names
        /// each `step` on the way, so each opens once.
        func opensForSample(
            _ screen: SampleScreen, step: String = "", when isReady: Bool = true,
            _ open: @escaping @MainActor () -> Void
        ) -> some View {
            modifier(OpensForSample(screen: screen, step: step, isReady: isReady, open: open))
        }

        /// Opens the Settings page the launch's screen shows on, once the shell knows the
        /// window's size: in the Settings sheet on iPhone, on the Settings tab on iPad. The Mac
        /// opens its Settings window instead.
        func opensSampleSettingsPage(_ place: ShellPlace) -> some View {
            modifier(OpensSampleSettingsPage(place: place))
        }
    }

    private struct OpensForSample: ViewModifier {
        /// Shared, since a view that is made again would otherwise open its surface again.
        @MainActor private static var opened: Set<String> = []

        let screen: SampleScreen
        let step: String
        let isReady: Bool
        let open: @MainActor () -> Void

        @Environment(\.sampleScreen) private var sampleScreen

        func body(content: Content) -> some View {
            let key = "\(screen.rawValue)/\(step)"
            return content.task(id: sampleScreen == screen && isReady) {
                guard sampleScreen == screen, isReady, !Self.opened.contains(key) else { return }
                try? await Task.sleep(for: .milliseconds(600))
                guard !Task.isCancelled, Self.opened.insert(key).inserted else { return }
                open()
            }
        }
    }

    private struct OpensSampleSettingsPage: ViewModifier {
        let place: ShellPlace

        @Environment(\.sampleScreen) private var sampleScreen

        func body(content: Content) -> some View {
            #if os(macOS)
                content
            #else
                if let sampleScreen, let page = sampleScreen.settingsPage {
                    content.opensForSample(sampleScreen, step: "settings page", when: place.knowsSize) {
                        place.showSettingsPage(page)
                    }
                } else {
                    content
                }
            #endif
        }
    }

    #if !os(macOS)
        extension SampleScreen {
            /// The Settings page a screen shows on, which the shell opens at launch.
            var settingsPage: SettingsPage? {
                switch self {
                case .importTunes, .export: .category(.importExport)
                case .deleteAccount: .account
                case .stats: .stats
                case .savedLocations: .category(.recordings)
                default: nil
                }
            }
        }
    #endif

    #if os(macOS)
        extension SampleScreen {
            /// The Settings tab a screen shows on, which the sample shell opens at launch.
            var settingsTab: MacSettingsTabs.Pane? {
                switch self {
                case .importTunes, .export: .importExport
                case .deleteAccount, .stats: .account
                case .musicServices: .tunes
                case .savedLocations: .recordings
                default: nil
                }
            }

            /// The tab named after `-SampleSettingsTab` in the launch arguments, by its case
            /// name (`importExport`) or stored name (`import-export`).
            static func settingsTab(_ arguments: [String] = CommandLine.arguments) -> MacSettingsTabs.Pane? {
                guard let flag = arguments.firstIndex(of: "-SampleSettingsTab"), arguments.indices.contains(flag + 1)
                else { return nil }
                let name = arguments[flag + 1]
                return MacSettingsTabs.Pane.allCases.first { "\($0)" == name || $0.rawValue == name }
            }
        }
    #endif
#endif
