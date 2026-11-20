#if os(iOS)
    import AppIntents

    /// Lists this module's intents for a bundle that includes it in its own `AppIntentsPackage`.
    public struct RecordingActivityIntents: AppIntentsPackage {}

    // The App Intents metadata extractor accepts only a string literal for `title`, so these
    // repeat `RecordingActivityText.stop` and `.resume` rather than reference them.

    public struct StopRecordingIntent: LiveActivityIntent {
        public static let title: LocalizedStringResource = "Stop"

        @Dependency var control: any RecordingControl

        public init() {}

        public func perform() async throws -> some IntentResult {
            await RecordingButton.stop.perform(on: control)
            return .result()
        }
    }

    public struct ResumeRecordingIntent: LiveActivityIntent {
        public static let title: LocalizedStringResource = "Resume"

        @Dependency var control: any RecordingControl

        public init() {}

        public func perform() async throws -> some IntentResult {
            await RecordingButton.resume.perform(on: control)
            return .result()
        }
    }
#endif
