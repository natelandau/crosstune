import Foundation
import Testing

/// The app makes a haptic only for loop-handle snaps and track skips from the now-playing
/// accessory. Every other control leaves feedback to the system.
@Suite struct HapticsPolicyTests {
    static let allowed: Set<String> = ["PracticeWaveform.swift", "PlayerBar.swift"]

    /// SwiftUI's haptic modifier and every UIKit and AppKit haptic generator.
    static let hapticMarkers = [
        ".sensoryFeedback(", "UIImpactFeedbackGenerator", "UISelectionFeedbackGenerator",
        "UINotificationFeedbackGenerator", "NSHapticFeedbackManager",
    ]

    @Test func onlyHandleSnapsAndTrackSkipsMakeHaptics() throws {
        let files = SourceScan.files()
        #expect(!files.isEmpty)
        let violations = try files.filter { file in
            let source = try String(contentsOf: file, encoding: .utf8)
            return Self.hapticMarkers.contains { source.contains($0) }
        }.map(\.lastPathComponent).filter { !Self.allowed.contains($0) }.sorted()
        #expect(violations.isEmpty, "Haptics outside the allowlist: \(violations.joined(separator: ", "))")
    }
}
