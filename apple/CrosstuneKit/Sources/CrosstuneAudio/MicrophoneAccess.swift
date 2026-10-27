import Foundation

#if canImport(UIKit)
    import UIKit
#endif

public enum MicrophoneAccess {
    /// Where the user grants microphone access to Crosstune.
    public static var settingsURL: URL? {
        #if os(iOS)
            URL(string: UIApplication.openSettingsURLString)
        #else
            URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        #endif
    }
}
