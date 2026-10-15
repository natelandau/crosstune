import CrosstuneAuth
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

/// The welcome screen's words.
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
    public static let createAccount = "Create account"
    public static let signIn = "Sign in"
}

/// The welcome screen's buttons, top to bottom, and the flow each opens.
enum WelcomeButton: CaseIterable, Identifiable {
    case createAccount
    case signIn

    var id: Self { self }

    var label: String {
        switch self {
        case .createAccount: WelcomeCopy.createAccount
        case .signIn: WelcomeCopy.signIn
        }
    }

    var mode: AuthMode {
        switch self {
        case .createAccount: .signUp
        case .signIn: .signIn
        }
    }

    /// The one filled button; the rest are borderless.
    var isProminent: Bool { self == .createAccount }
}

/// How the welcome screen fits Dynamic Type.
enum WelcomeLayout {
    /// The picture is fixed in size, so at the accessibility sizes it gives its room to the
    /// words and buttons.
    static func showsPicture(_ size: DynamicTypeSize) -> Bool {
        !size.isAccessibilitySize
    }
}
