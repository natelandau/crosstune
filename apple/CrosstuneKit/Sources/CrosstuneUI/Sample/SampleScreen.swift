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
        case editRecording = "edit-recording"
        /// The edit sheet opened on its location page, for a recording at a saved location.
        case editLocation = "edit-location"
        case addToTune = "add-to-tune"
        case record
        case listNew = "list-new"
        case listPicker = "list-picker"
        case tunePicker = "tune-picker"
        case whatPlays = "what-plays"
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
        /// The music services sheet Find recordings opens, shown over the Tunes tab.
        case musicServices = "music-services"
        case stats
        /// The first saved location's sheet over the Recordings tab.
        case savedLocations = "saved-locations"
        case welcome
        case signIn = "signin"

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
        /// The recording the edit sheet opens: one with a name and its audio here, so every field
        /// has something to show.
        static var editedRecordingID: String {
            let richest = SampleCatalog.recordings.first {
                $0.recording.label != nil && $0.file?.localState == .downloaded
            }
            return (richest ?? SampleCatalog.recordings[0]).recording.id
        }
        /// A recording filed under no tune, for the add to tune sheet.
        static var unfiledRecordingID: String {
            (SampleCatalog.recordings.first { $0.recording.tuneID == nil } ?? SampleCatalog.recordings[0]).recording.id
        }

        /// Shows the signed-out welcome screen in place of the shell.
        var isSignedOut: Bool { self == .welcome || self == .signIn }

        /// Opens a store with no tunes, lists, or recordings.
        var isEmpty: Bool { self == .emptyCatalog }

        /// Where the shell opens: the sidebar row and the detail column's tune.
        @MainActor func place() -> ShellPlace {
            let place = ShellPlace()
            switch self {
            case .recordings, .recordingsFilters, .recordingsSetFilters, .editRecording, .editLocation, .addToTune:
                place.sidebar = .recordings
            case .list, .listSelecting, .tunePicker, .whatPlays: place.sidebar = .list(id: Self.listID)
            default: break
            }
            if !isEmpty { place.detailTune = self == .tuneArchived ? Self.archivedTuneID : Self.tuneID }
            return place
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
        /// another presentation still under way.
        func opensForSample(
            _ screen: SampleScreen, when isReady: Bool = true, _ open: @escaping @MainActor () -> Void
        ) -> some View {
            modifier(OpensForSample(screen: screen, isReady: isReady, open: open))
        }
    }

    private struct OpensForSample: ViewModifier {
        /// Shared, since a view that is made again would otherwise open its surface again.
        @MainActor private static var opened: Set<SampleScreen> = []

        let screen: SampleScreen
        let isReady: Bool
        let open: @MainActor () -> Void

        @Environment(\.sampleScreen) private var sampleScreen

        func body(content: Content) -> some View {
            content.task(id: sampleScreen == screen && isReady) {
                guard sampleScreen == screen, isReady, !Self.opened.contains(screen) else { return }
                try? await Task.sleep(for: .milliseconds(600))
                guard !Task.isCancelled, Self.opened.insert(screen).inserted else { return }
                open()
            }
        }
    }

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
