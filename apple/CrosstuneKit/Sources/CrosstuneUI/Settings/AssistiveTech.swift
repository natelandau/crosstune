import CrosstuneAnalytics
import Foundation

#if os(iOS)
    import UIKit
#elseif os(macOS)
    import AppKit
#endif

/// The assistive features the device has on, as the person property values they stand for.
public enum AssistiveTech {
    @MainActor public static func current() -> [AssistiveTechnology] {
        #if os(iOS)
            let features: [(AssistiveTechnology, Bool)] = [
                (.voiceover, UIAccessibility.isVoiceOverRunning),
                (.switchControl, UIAccessibility.isSwitchControlRunning),
                (.largeText, UIApplication.shared.preferredContentSizeCategory.isAccessibilityCategory),
                (.reduceMotion, UIAccessibility.isReduceMotionEnabled),
                (.boldText, UIAccessibility.isBoldTextEnabled),
            ]
        #else
            let workspace = NSWorkspace.shared
            let features: [(AssistiveTechnology, Bool)] = [
                (.voiceover, workspace.isVoiceOverEnabled),
                (.switchControl, workspace.isSwitchControlEnabled),
                (.reduceMotion, workspace.accessibilityDisplayShouldReduceMotion),
            ]
        #endif
        return features.filter(\.1).map(\.0)
    }
}
