import CoreGraphics

/// How the practice screen shares a regular-width window with the playing tune's scans and
/// lyrics.
enum StandArrangement: Equatable {
    /// Practice alone, its controls capped and centered.
    case practiceOnly
    /// Practice leading, reading trailing.
    case sideBySide
    /// Practice over reading.
    case stacked

    /// Practice alone when there is nothing to read or the musician hid it. Otherwise the panes
    /// stack in a portrait window, where a scan needs height, and at accessibility text sizes,
    /// where practice beside reading would be too narrow for its controls.
    static func arrange(
        size: CGSize, hasReading: Bool, readingHidden: Bool, isAccessibilitySize: Bool
    ) -> StandArrangement {
        guard hasReading, !readingHidden else { return .practiceOnly }
        return isAccessibilitySize || size.height > size.width ? .stacked : .sideBySide
    }

    /// Practice's share of the height when the panes stack. A portrait window gives reading the
    /// larger share, since a scan needs height; a landscape one, stacked only for large text,
    /// has too little height for that, so practice keeps the larger share and its transport.
    static func stackedPracticeShare(_ size: CGSize) -> CGFloat {
        size.height > size.width ? 1 - PadStyle.standReadingShare : PadStyle.standPracticeShare
    }

    /// Whether the panes are in their real arrangement and may show: once the reading has read,
    /// at once unless they stack, and when they stack, once practice that measures its controls
    /// has reported the height they need.
    static func isSettled(
        _ arrangement: StandArrangement, hasRead: Bool, practiceMeasures: Bool, hasPracticeMinimum: Bool
    ) -> Bool {
        guard hasRead else { return false }
        return arrangement != .stacked || !practiceMeasures || hasPracticeMinimum
    }
}

/// What the reading pane shows: the tune's scans or its lyrics.
enum ReadingChoice: String {
    case scans
    case lyrics

    /// The choices the pane's segmented control offers, scans first, or none when the tune has
    /// only one kind to read.
    static func segments(_ reading: StandReading) -> [ReadingChoice] {
        reading.scans.isEmpty || reading.lyrics == nil ? [] : [.scans, .lyrics]
    }
}
