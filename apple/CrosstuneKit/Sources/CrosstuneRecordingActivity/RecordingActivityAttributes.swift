#if os(iOS)
    import ActivityKit

    /// The recording Live Activity. It has no stored properties, so it names no tune or recording.
    public struct RecordingActivityAttributes: ActivityAttributes {
        public typealias ContentState = RecordingActivityState

        public init() {}
    }
#endif
