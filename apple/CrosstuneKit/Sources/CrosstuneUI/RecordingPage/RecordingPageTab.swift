import CoreGraphics
import CrosstuneAnalytics
import CrosstuneDesign
import Foundation

/// The compact recording page's two tabs, Practice first. Every page opens on Practice.
public enum RecordingPageTab: String, CaseIterable, Identifiable, Sendable {
    case practice
    case details

    public var id: Self { self }

    var label: String {
        switch self {
        case .details: RecordingPageCopy.details
        case .practice: RecordingPageCopy.practice
        }
    }

    var systemImage: String {
        switch self {
        case .details: "info.circle"
        case .practice: "waveform"
        }
    }
}

/// How the recording page lays itself out for the width of the column it sits in.
enum RecordingPageArrangement {
    /// The narrowest page that holds the attributes column beside the practice view at its
    /// narrowest; below it the column folds back into the Details and Practice tabs.
    static var foldWidth: CGFloat {
        PageStyle.attributesColumnWidth + PageStyle.attributesColumnGap + RecordingScreen.minimumWidth
    }

    /// Wide where `allowsWide` and the column is at least ``foldWidth``, otherwise the tab that
    /// shows. Practice cannot be used while the plan holds recordings back, so Details shows then.
    /// `allowsWide` is false where the page is pushed over a compact window, which is never wide.
    static func layout(
        width: CGFloat, allowsWide: Bool, tab: RecordingPageTab, recordingsPlay: Bool
    ) -> RecordingPageLayout {
        if allowsWide, width >= foldWidth { return .wide }
        return recordingsPlay && tab == .practice ? .practice : .details
    }

    static func showsTabs(_ layout: RecordingPageLayout) -> Bool {
        layout != .wide
    }

    /// Whether the Details tab carries the list controls: while the page's recording is the
    /// loaded one. The row draws only while a list plays.
    static func showsListControls(isCurrent: Bool) -> Bool { isCurrent }
}
