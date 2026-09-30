import Foundation
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// The kind of device the welcome screen names in its headline.
public enum WelcomeDevice: Sendable {
    case phone
    case pad
    case mac

    /// The device this app runs on.
    @MainActor public static var current: WelcomeDevice {
        #if os(macOS)
            .mac
        #else
            UIDevice.current.userInterfaceIdiom == .pad ? .pad : .phone
        #endif
    }
}

/// The welcome screen's words, and where Join the waitlist goes.
public enum WelcomeCopy {
    /// The headline, ending in the device the player holds.
    public static func headline(for device: WelcomeDevice) -> String {
        let name =
            switch device {
            case .phone: "phone"
            case .pad: "iPad"
            case .mac: "Mac"
            }
        return "The tune list in your case, rebuilt for your \(name)."
    }

    public static let line = "The tunes you know and the tunes you're learning, with a recording one tap away."
    public static let signIn = "Sign in"
    public static let joinWaitlist = "Join the waitlist"
    /// The site's waitlist form. The Clerk SDK for Apple has no waitlist flow of its own.
    public static let waitlistURL = URL(string: "https://crosstune.app/waitlist")!
}

/// How the welcome screen fits Dynamic Type.
enum WelcomeLayout {
    /// The picture is fixed in size, so at the accessibility sizes it gives its room to the
    /// words and buttons.
    static func showsPicture(_ size: DynamicTypeSize) -> Bool {
        !size.isAccessibilitySize
    }
}
