#if os(iOS)
    import AppIntents
    import CrosstuneWidgetData
    import WidgetKit

    /// Lists this module's intents for a bundle that includes it in its own `AppIntentsPackage`.
    public struct WidgetIntents: AppIntentsPackage {}

    // The App Intents metadata extractor accepts only string literals for titles, so these repeat
    // the app's words rather than reference its constants.
    //
    // Each intent sets `isDiscoverable` to false, so Shortcuts and Spotlight offer none of them.

    /// Opens the app and asks it to start a recording.
    public struct StartRecordingIntent: AppIntent {
        public static let title: LocalizedStringResource = "Record"
        public static let isDiscoverable = false
        public static let supportedModes: IntentModes = .foreground

        var inbox: WidgetRequestInbox = .shared

        public init() {}

        public func perform() async throws -> some IntentResult {
            await inbox.post(.record)
            return .result()
        }
    }

    /// Opens the app and plays a recording.
    public struct PlayRecordingIntent: AppIntent {
        public static let title: LocalizedStringResource = "Play Recording"
        public static let isDiscoverable = false
        public static let supportedModes: IntentModes = .foreground

        @Parameter(title: "Recording") public var recording: RecordingEntity

        var inbox: WidgetRequestInbox = .shared

        public init() {}

        public init(recording: RecordingEntity) {
            self.recording = recording
        }

        public func perform() async throws -> some IntentResult {
            await inbox.post(.playRecording(id: recording.id))
            return .result()
        }
    }

    /// Opens the app and plays a list from the top, in order or shuffled.
    public struct PlayListIntent: AppIntent {
        public static let title: LocalizedStringResource = "Play List"
        public static let isDiscoverable = false
        public static let supportedModes: IntentModes = .foreground

        @Parameter(title: "List") public var list: ListEntity
        @Parameter(title: "Shuffle", default: false) public var shuffled: Bool

        var inbox: WidgetRequestInbox = .shared

        public init() {}

        public init(list: ListEntity, shuffled: Bool) {
            self.list = list
            self.shuffled = shuffled
        }

        public func perform() async throws -> some IntentResult {
            await inbox.post(.playList(id: list.id, shuffled: shuffled))
            return .result()
        }
    }

    /// Opens the app and plays a list starting at one of its tunes.
    public struct PlayListFromTuneIntent: AppIntent {
        public static let title: LocalizedStringResource = "Play List from Tune"
        public static let isDiscoverable = false
        public static let supportedModes: IntentModes = .foreground

        @Parameter(title: "List") public var list: ListEntity
        @Parameter(title: "Tune") public var tune: TuneEntity

        var inbox: WidgetRequestInbox = .shared

        public init() {}

        public init(list: ListEntity, tune: TuneEntity) {
            self.list = list
            self.tune = tune
        }

        public func perform() async throws -> some IntentResult {
            await inbox.post(.playListFromTune(id: list.id, tuneID: tune.id))
            return .result()
        }
    }

    /// Opens the app on a list.
    public struct OpenListIntent: AppIntent {
        public static let title: LocalizedStringResource = "Open List"
        public static let isDiscoverable = false
        public static let supportedModes: IntentModes = .foreground

        @Parameter(title: "List") public var list: ListEntity

        var inbox: WidgetRequestInbox = .shared

        public init() {}

        public init(list: ListEntity) {
            self.list = list
        }

        public func perform() async throws -> some IntentResult {
            await inbox.post(.openList(id: list.id))
            return .result()
        }
    }

    /// Opens the app on the tuner.
    public struct OpenTunerIntent: AppIntent {
        public static let title: LocalizedStringResource = "Open Tuner"
        public static let isDiscoverable = false
        public static let supportedModes: IntentModes = .foreground

        var inbox: WidgetRequestInbox = .shared

        public init() {}

        public func perform() async throws -> some IntentResult {
            await inbox.post(.openTuner)
            return .result()
        }
    }

    /// Opens the app on the plan screen.
    public struct OpenPlanIntent: AppIntent {
        public static let title: LocalizedStringResource = "Open Plans"
        public static let isDiscoverable = false
        public static let supportedModes: IntentModes = .foreground

        var inbox: WidgetRequestInbox = .shared

        public init() {}

        public func perform() async throws -> some IntentResult {
            await inbox.post(.openPlan)
            return .result()
        }
    }

    /// Opens the app where the musician left it.
    public struct OpenAppIntent: AppIntent {
        public static let title: LocalizedStringResource = "Open Crosstune"
        public static let isDiscoverable = false
        public static let supportedModes: IntentModes = .foreground

        var inbox: WidgetRequestInbox = .shared

        public init() {}

        public func perform() async throws -> some IntentResult {
            await inbox.post(.openApp)
            return .result()
        }
    }

    /// Pauses list playback without opening the app.
    public struct PauseListIntent: AudioPlaybackIntent {
        public static let title: LocalizedStringResource = "Pause"
        public static let isDiscoverable = false

        @Dependency var control: any WidgetPlaybackControl

        public init() {}

        /// A value set on `control` is stored in its manager, so a test passes its own manager to
        /// keep its fake from reaching another test's intent.
        init(dependencies: AppDependencyManager) {
            _control = Dependency(manager: dependencies)
        }

        public func perform() async throws -> some IntentResult {
            await control.pauseList()
            return .result()
        }
    }

    /// Resumes paused list playback without opening the app.
    public struct ResumeListIntent: AudioPlaybackIntent {
        public static let title: LocalizedStringResource = "Resume"
        public static let isDiscoverable = false

        @Dependency var control: any WidgetPlaybackControl

        public init() {}

        /// A value set on `control` is stored in its manager, so a test passes its own manager to
        /// keep its fake from reaching another test's intent.
        init(dependencies: AppDependencyManager) {
            _control = Dependency(manager: dependencies)
        }

        public func perform() async throws -> some IntentResult {
            await control.resumeList()
            return .result()
        }
    }

    /// Shows another page of a List widget without opening the app.
    public struct ShowListPageIntent: AppIntent {
        public static let title: LocalizedStringResource = "Show List Page"
        public static let isDiscoverable = false

        @Parameter(title: "List") public var widgetListID: String
        /// A ``ListWidgetSize`` raw value, since each size keeps its own page.
        @Parameter(title: "Size") public var widgetSize: String
        @Parameter(title: "Page") public var page: Int

        public init() {}

        public init(widgetListID: String, size: ListWidgetSize, page: Int) {
            self.widgetListID = widgetListID
            self.widgetSize = size.rawValue
            self.page = page
        }

        public func perform() async throws -> some IntentResult {
            guard let size = ListWidgetSize(rawValue: widgetSize) else {
                throw ShowListPageError.unknownSize(widgetSize)
            }
            ListWidgetPageStore.appGroup()?.setPage(page, forList: widgetListID, size: size)
            WidgetCenter.shared.reloadTimelines(ofKind: WidgetKind.list.rawValue)
            return .result()
        }
    }

    public enum ShowListPageError: Error, CustomStringConvertible {
        case unknownSize(String)

        public var description: String {
            switch self {
            case .unknownSize(let value):
                "List widget size \"\(value)\" is not one of "
                    + ListWidgetSize.allCases.map(\.rawValue).joined(separator: ", ")
            }
        }
    }

    /// Picks the list a List widget shows.
    public struct ListWidgetConfigurationIntent: WidgetConfigurationIntent {
        public static let title: LocalizedStringResource = "Choose List"
        public static let isDiscoverable = false

        @Parameter(title: "List") public var list: ListEntity?

        public init() {}
    }
#endif
