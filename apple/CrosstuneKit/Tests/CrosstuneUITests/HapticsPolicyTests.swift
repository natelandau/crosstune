import Foundation
import Testing

/// The app makes a haptic only for slider and loop-handle snaps and track skips from the
/// now-playing accessory. Every other control leaves feedback to the system.
struct HapticsPolicyTests {
    /// Each file allowed a haptic, by its path under its module, and why.
    static let allowed: [String: String] = [
        "Player/PlayerBar.swift": "track skip from the now-playing accessory",
        "Phone/Controls/ValueSlider.swift": "tap when a drag reaches the default",
        "Phone/Controls/RangeHandles.swift": "tap when a handle snaps",
        "Mac/MacSlider.swift": "trackpad tap when a drag reaches the default",
    ]

    /// SwiftUI's haptic modifier and every UIKit and AppKit haptic generator.
    static let hapticMarkers = [
        ".sensoryFeedback(", "UIImpactFeedbackGenerator", "UISelectionFeedbackGenerator",
        "UINotificationFeedbackGenerator", "NSHapticFeedbackManager",
    ]

    @Test func onlySnapsAndTrackSkipsMakeHaptics() throws {
        let files = SourceScan.files()
        #expect(files.isEmpty == false)
        let violations = try files.filter { file in
            let source = try String(contentsOf: file, encoding: .utf8)
            return Self.hapticMarkers.contains { source.contains($0) }
        }.map(SourceScan.relative).filter { Self.allowed[$0] == nil }.sorted()
        #expect(violations.isEmpty, "Haptics outside the allowlist: \(violations.joined(separator: ", "))")
    }

    /// Every allowed path names a file, so a move never leaves a stale entry.
    @Test func everyAllowedFileExists() {
        for path in Self.allowed.keys {
            #expect(FileManager.default.fileExists(atPath: SourceScan.url(of: path).path), "\(path)")
        }
    }
}
