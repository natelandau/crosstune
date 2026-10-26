import CrosstuneAnalytics
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

    static let catalogHeadline = "Filter your tunes by key, tuning, time signature, and more."
    static let recordHeadline = "Your tune list and your recordings, finally in one place."
    static let practiceHeadline = "Slow it down. Loop the hard part."
    static let listenHeadline = "Play any tune from the services you already use."
    static let tunerHeadline = "Tune up without leaving the app."

    public static let emailNotice = "Free to use. No card needed."

    /// Why the account is worth having, naming the devices other than this one.
    public static func reason(for device: WelcomeDevice) -> String {
        let others =
            switch device {
            case .phone: "your iPad, your Mac"
            case .pad: "your iPhone, your Mac"
            case .mac: "your iPhone, your iPad"
            }
        return "Free to use. Your account syncs your tunes to \(others), and the web."
    }

    public static let alreadyHaveAccount = "I already have an account"
    public static let whyLink = "Why do I need an account?"
    public static let whyTitle = "Why an account?"
    public static let whyBody = [
        "Your catalog lives on this device and works offline. Your account copies it to your other devices: an iPhone, an iPad, a Mac, or any web browser.",
        "The account is free, with no card. Only you can see your catalog. You can export it or delete it at any time.",
    ]
    public static let whyDone = "Done"
    public static let signUpWithApple = "Sign up with Apple"
    public static let signUpWithGoogle = "Sign up with Google"
    public static let signUpWithEmail = "Sign up with email"

    static let previousSlide = "Previous slide"
    static let nextSlide = "Next slide"

    /// Where `slide` sits in the carousel, as VoiceOver reads it.
    static func slidePosition(_ slide: WelcomeSlide) -> String {
        "\(slide.number) of \(WelcomeSlide.allCases.count)"
    }

    /// The name of the dot that shows `slide`.
    static func dotLabel(_ slide: WelcomeSlide) -> String {
        "Slide \(slidePosition(slide))"
    }
}

/// The welcome screen's sign-up buttons, top to bottom, all equal in size and style.
enum SignUpButton: CaseIterable, Identifiable {
    case apple
    case google
    case email

    var id: Self { self }

    var label: String {
        switch self {
        case .apple: WelcomeCopy.signUpWithApple
        case .google: WelcomeCopy.signUpWithGoogle
        case .email: WelcomeCopy.signUpWithEmail
        }
    }

    var method: SignUpMethod {
        switch self {
        case .apple: .apple
        case .google: .google
        case .email: .email
        }
    }

    /// The provider's mark leading the label, as each provider's guidelines ask: Apple's logo,
    /// and Google's standard full-color "G", drawn from Google's own asset and never recolored,
    /// resized, or replaced by a monochrome stand-in. Email has no provider, so no mark.
    var mark: SignUpMark? {
        switch self {
        case .apple: .symbol("apple.logo")
        case .google: .asset(.googleG)
        case .email: nil
        }
    }

    /// The provider a native flow signs up with, nil for email, which goes through Clerk's form.
    var provider: SignUpProvider? {
        switch self {
        case .apple: .apple
        case .google: .google
        case .email: nil
        }
    }
}

/// A sign-up button's leading mark: an SF Symbol, or an image in CrosstuneUI's asset catalog.
enum SignUpMark: Equatable {
    case symbol(String)
    case asset(ImageResource)
}

/// How the welcome screen fits Dynamic Type.
enum WelcomeLayout {
    /// The picture is fixed in size, so at the accessibility sizes it gives its room to the
    /// words and buttons.
    static func showsPicture(_ size: DynamicTypeSize) -> Bool {
        !size.isAccessibilitySize
    }

    /// The picture's unit in a pane of `pane`: the drawing spans about two thirds of the pane's
    /// width and leaves `reserved` of its height to the headline and the controls under it, never
    /// smaller than `minimum` nor larger than it reads.
    static func pictureUnit(pane: CGSize, reserved: CGFloat, minimum: CGFloat) -> CGFloat {
        let fit = min(pane.width * 0.68 / 22.4, (pane.height - reserved) / 17)
        return min(max(fit, minimum), 30)
    }

    #if os(macOS)
        static let macMinimumUnit: CGFloat = 14
    #endif

    /// The least an iPhone or iPad column or pane draws at.
    static let phoneUnit: CGFloat = 12
    /// The most a one-column window draws at, past which the drawing outgrows the words under it.
    static let columnMaximumUnit: CGFloat = 18

    /// The picture's unit in a one-column window: the stage spans the column's `width` and
    /// takes the height left once `rest`, everything in the column but the stage, has its own,
    /// so a tall phone's spare height goes to the drawing rather than to empty space. Never
    /// smaller than `phoneUnit`, so a short phone scrolls instead.
    static func columnUnit(width: CGFloat, height: CGFloat, rest: CGFloat) -> CGFloat {
        let fit = min(width / 22.4, (height - rest) / 17)
        return min(max(fit, phoneUnit), columnMaximumUnit)
    }

    /// Whether an iPhone or iPad window of `size` splits into the carousel and account panes
    /// rather than one column. Wide enough for two panes as narrow as the Mac's smallest window,
    /// and tall enough for the account without scrolling, so a phone held sideways keeps its
    /// column.
    static func splits(_ size: CGSize) -> Bool {
        size.width >= 700 && size.height >= 560
    }

    /// How much of its stage a slide drawing spans, leaving the stage a margin around it.
    static let stageContentShare: CGFloat = 0.86

    /// `label` broken before its last two words, "Sign up\nwith Google", so every sign-up title
    /// wraps at one place.
    static func stackedLabel(_ label: String) -> String {
        var words = label.split(separator: " ").map(String.init)
        guard words.count > 2 else { return label }
        let tail = words.suffix(2).joined(separator: " ")
        words.removeLast(2)
        return words.joined(separator: " ") + "\n" + tail
    }

    /// The space a carousel pane measures its slides' top in, which the account pane matches.
    static let slidesSpace = "welcomeSlides"

    /// Whether the carousel draws its focus ring: only in the key window, and only once the
    /// person reaches it by keyboard, since focus set at launch or after a click means nothing
    /// to them. Full Keyboard Access alone draws no ring, or it would show at rest.
    static func showsFocusRing(focused: Bool, windowIsKey: Bool, byKeyboard: Bool) -> Bool {
        focused && windowIsKey && byKeyboard
    }

    #if os(macOS)
        /// Whether focus reaching the carousel came from a key, such as Tab, rather than from a
        /// click or from the screen giving it the arrow keys (`quietly`).
        static func focusArrivedByKeyboard(focused: Bool, quietly: Bool, event: NSEvent.EventType?) -> Bool {
            focused && !quietly && event == .keyDown
        }
    #endif
}
