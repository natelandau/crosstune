import CrosstuneAnalytics
import CrosstuneTestSupport
import Foundation
import SwiftUI
import Testing

@testable import CrosstuneAuth
@testable import CrosstuneUI

@Suite struct WelcomeTests {
    @Test func theHeadlineNamesTheDevice() {
        #expect(WelcomeCopy.headline(for: .phone) == "The tune list in your case, rebuilt for your phone.")
        #expect(WelcomeCopy.headline(for: .pad) == "The tune list in your case, rebuilt for your iPad.")
        #expect(WelcomeCopy.headline(for: .mac) == "The tune list in your case, rebuilt for your Mac.")
    }

    @Test func theSlidesRunInOrder() {
        #expect(WelcomeSlide.allCases.map(\.name) == [.story, .catalog, .record, .practice, .listen, .tuner])
        #expect(
            WelcomeSlide.allCases.dropFirst().map { $0.headline(for: .phone) } == [
                WelcomeCopy.catalogHeadline, WelcomeCopy.recordHeadline, WelcomeCopy.practiceHeadline,
                WelcomeCopy.listenHeadline, WelcomeCopy.tunerHeadline,
            ])
    }

    @Test func theStorySlideNamesTheDevice() {
        #expect(WelcomeSlide.story.headline(for: .pad) == WelcomeCopy.headline(for: .pad))
    }

    @Test func theReasonNamesTheOtherDevices() {
        #expect(
            WelcomeCopy.reason(for: .phone)
                == "Free to use. Your account syncs your tunes to your iPad, your Mac, and the web.")
        #expect(
            WelcomeCopy.reason(for: .pad)
                == "Free to use. Your account syncs your tunes to your iPhone, your Mac, and the web.")
        #expect(
            WelcomeCopy.reason(for: .mac)
                == "Free to use. Your account syncs your tunes to your iPhone, your iPad, and the web.")
    }

    @Test func threeEqualButtonsAppleFirst() {
        #expect(
            SignUpButton.allCases.map(\.label) == [
                WelcomeCopy.signUpWithApple, WelcomeCopy.signUpWithGoogle, WelcomeCopy.signUpWithEmail,
            ])
        #expect(SignUpButton.allCases.map(\.method) == [.apple, .google, .email])
    }

    @Test func appleAndGoogleRowsCarryTheirMarksAndEmailNone() {
        #expect(SignUpButton.allCases.map(\.mark) == [.symbol("apple.logo"), .asset(.googleG), nil])
    }

    @Test func everySignUpTitleStacksAfterSignUp() {
        #expect(
            SignUpButton.allCases.map { WelcomeLayout.stackedLabel($0.label) } == [
                "Sign up\nwith Apple", "Sign up\nwith Google", "Sign up\nwith email",
            ])
        #expect(WelcomeLayout.stackedLabel("Done") == "Done")
    }

    @Test func theCarouselStopsAtTheEndsAndRemembersTheFurthest() {
        var carousel = WelcomeCarousel()
        carousel.previous()
        #expect(carousel.current == .story)
        for _ in 1..<WelcomeSlide.allCases.count { carousel.next() }
        #expect(carousel.current == .tuner)
        carousel.next()
        #expect(carousel.current == .tuner)
        carousel.show(.catalog)
        #expect(carousel.current == .catalog)
        #expect(carousel.furthest == .tuner)
        carousel.previous()
        #expect(carousel.current == .story)
        #expect(carousel.furthest == .tuner)
    }

    @Test func thePictureYieldsAtAccessibilitySizes() {
        #expect(WelcomeLayout.showsPicture(.large))
        #expect(WelcomeLayout.showsPicture(.xxxLarge))
        #expect(!WelcomeLayout.showsPicture(.accessibility1))
        #expect(!WelcomeLayout.showsPicture(.accessibility5))
    }

    @Test func thePictureFitsItsPaneWithinItsBounds() {
        let fitted = WelcomeLayout.pictureUnit(pane: CGSize(width: 560, height: 900), reserved: 220, minimum: 12)
        #expect(abs(fitted - 17) < 0.001)
        #expect(WelcomeLayout.pictureUnit(pane: CGSize(width: 300, height: 900), reserved: 220, minimum: 12) == 12)
        #expect(WelcomeLayout.pictureUnit(pane: CGSize(width: 2000, height: 2000), reserved: 220, minimum: 12) == 30)
    }

    @Test func theColumnStageTakesTheSpareHeightWithinItsBounds() {
        // A tall phone: the stage fills the column's width and leaves height unused.
        #expect(abs(WelcomeLayout.columnUnit(width: 354, height: 810, rest: 480) - 354 / 22.4) < 0.001)
        // Less height than width: the stage takes exactly what the rest leaves.
        #expect(abs(WelcomeLayout.columnUnit(width: 354, height: 740, rest: 480) - 260 / 17) < 0.001)
        // A short phone keeps the least unit and scrolls.
        #expect(WelcomeLayout.columnUnit(width: 327, height: 620, rest: 480) == WelcomeLayout.phoneUnit)
        // Unmeasured, the stage draws at its least.
        #expect(WelcomeLayout.columnUnit(width: 354, height: 810, rest: .infinity) == WelcomeLayout.phoneUnit)
        // A wide window stops at the most.
        #expect(WelcomeLayout.columnUnit(width: 480, height: 2000, rest: 480) == WelcomeLayout.columnMaximumUnit)
    }

    @Test func onlyAWideTallWindowSplits() {
        // Full-screen iPad and an iPad mini in portrait.
        #expect(WelcomeLayout.splits(CGSize(width: 1032, height: 1376)))
        #expect(WelcomeLayout.splits(CGSize(width: 744, height: 1133)))
        // Half of a split iPad, Slide Over, an iPhone, and an iPhone held sideways.
        #expect(!WelcomeLayout.splits(CGSize(width: 590, height: 834)))
        #expect(!WelcomeLayout.splits(CGSize(width: 320, height: 1000)))
        #expect(!WelcomeLayout.splits(CGSize(width: 440, height: 956)))
        #expect(!WelcomeLayout.splits(CGSize(width: 956, height: 440)))
    }

    @Test func theFocusRingWaitsForTheKeyboardInTheKeyWindow() {
        #expect(WelcomeLayout.showsFocusRing(focused: true, windowIsKey: true, byKeyboard: true))
        #expect(!WelcomeLayout.showsFocusRing(focused: true, windowIsKey: true, byKeyboard: false))
        #expect(!WelcomeLayout.showsFocusRing(focused: true, windowIsKey: false, byKeyboard: true))
        #expect(!WelcomeLayout.showsFocusRing(focused: false, windowIsKey: true, byKeyboard: true))
    }

    #if os(macOS)
        @Test func onlyAKeyBringsTheCarouselItsRing() {
            #expect(WelcomeLayout.focusArrivedByKeyboard(focused: true, quietly: false, event: .keyDown))
            // A click, the screen handing over the arrow keys, or focus with no event at all.
            #expect(!WelcomeLayout.focusArrivedByKeyboard(focused: true, quietly: false, event: .leftMouseDown))
            #expect(!WelcomeLayout.focusArrivedByKeyboard(focused: true, quietly: true, event: .keyDown))
            #expect(!WelcomeLayout.focusArrivedByKeyboard(focused: true, quietly: false, event: nil))
            #expect(!WelcomeLayout.focusArrivedByKeyboard(focused: false, quietly: false, event: .keyDown))
        }
    #endif
}

/// Stands in for Clerk with an Apple flow that holds until `finish()`, as Apple's sheet stays up
/// until the person acts.
private final class SuspendingClerkCalls: ClerkSignUpCalls, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Never>?
    private var started: CheckedContinuation<Void, Never>?
    private var calls = 0

    var callCount: Int { lock.withLock { calls } }

    func apple() async throws {
        await withCheckedContinuation { continuation in
            let started = lock.withLock {
                calls += 1
                self.continuation = continuation
                return self.started
            }
            started?.resume()
        }
    }

    func google() async throws { try await apple() }
    var hasSession: Bool { get async { true } }

    /// Returns once `apple()` is waiting.
    func waitForCall() async {
        await withCheckedContinuation { started in
            let waiting = lock.withLock {
                if continuation != nil { return true }
                self.started = started
                return false
            }
            if waiting { started.resume() }
        }
    }

    func finish() {
        lock.withLock { continuation }?.resume()
    }
}

@MainActor
@Suite struct WelcomeModelTests {
    private let sink = RecordingAnalyticsSink()

    private func model(_ calls: StubClerkSignUpCalls = StubClerkSignUpCalls()) -> WelcomeModel {
        WelcomeModel(analytics: sink.client, signUp: NativeSignUp(calls: calls))
    }

    @Test func aSignUpTapReportsTheMethodAndFurthestSlide() async {
        let model = model()
        model.carousel.next()
        model.carousel.next()
        model.carousel.previous()

        await model.signUp(with: .google)

        #expect(
            sink.captures == [
                .init(
                    name: "sign_up_started",
                    properties: ["method": .string("google"), "furthest_slide": .string("record")])
            ])
    }

    @Test func emailOpensClerksSignUp() async {
        let model = model()
        await model.signUp(with: .email)
        #expect(model.authMode == .signUp)
        #expect(sink.captures.map(\.properties["method"]) == [.string("email")])
    }

    @Test func needsFormOpensClerksSignInOrUp() async {
        let model = model(StubClerkSignUpCalls(sessionAfterCall: false))
        await model.signUp(with: .apple)
        #expect(model.authMode == .signIn)
        #expect(model.failure == nil)
    }

    @Test func aSecondTapWhileASignUpRunsDoesNothing() async {
        let calls = SuspendingClerkCalls()
        let model = WelcomeModel(analytics: sink.client, signUp: NativeSignUp(calls: calls))
        #expect(model.signingUp == nil)

        let first = Task { await model.signUp(with: .apple) }
        await calls.waitForCall()
        #expect(model.signingUp == .apple)

        await model.signUp(with: .google)
        await model.signUp(with: .email)
        #expect(sink.captures.map(\.properties["method"]) == [.string("apple")])
        #expect(calls.callCount == 1)
        #expect(model.authMode == nil)

        calls.finish()
        await first.value
        #expect(model.signingUp == nil)
    }

    @Test func signedInPresentsNothing() async {
        let model = model(StubClerkSignUpCalls(sessionAfterCall: true))
        await model.signUp(with: .google)
        #expect(model.authMode == nil)
        #expect(model.failure == nil)
    }

    @Test func cancelShowsNothing() async {
        let model = model(StubClerkSignUpCalls(error: CancellationError(), sessionAfterCall: false))
        await model.signUp(with: .google)
        #expect(model.failure == nil)
        #expect(model.authMode == nil)
        #expect(!model.showsReason)
    }

    @Test func anErrorShowsAsAFailureOverTheHandedInNotice() async {
        let error = URLError(.notConnectedToInternet)
        let model = model(StubClerkSignUpCalls(error: error, sessionAfterCall: false))
        #expect(model.shownNotice(handedIn: DeletedNotice.text) == .info(DeletedNotice.text))
        await model.signUp(with: .apple)
        #expect(model.failure == failureMessage(error))
        #expect(model.shownNotice(handedIn: DeletedNotice.text) == .failure(failureMessage(error)))
        #expect(model.shownNotice(handedIn: nil) == .failure(failureMessage(error)))
        #expect(model.authMode == nil)
    }

    @Test func noFailureAndNothingHandedInShowsNoNotice() {
        #expect(model().shownNotice(handedIn: nil) == nil)
    }

    @Test func theNextTapClearsTheLastFailure() async {
        let model = model(StubClerkSignUpCalls(error: URLError(.notConnectedToInternet), sessionAfterCall: false))
        await model.signUp(with: .apple)
        await model.signUp(with: .email)
        #expect(model.failure == nil)
    }

    @Test func theWhyLinkReportsAndOpensTheSheet() {
        let model = model()
        model.openReason()
        #expect(sink.captures == [.init(name: "account_reason_opened", properties: [:])])
        #expect(model.showsReason)
    }

    @Test func iAlreadyHaveAnAccountOpensClerksSignIn() {
        let model = model()
        model.signIn()
        #expect(model.authMode == .signIn)
        #expect(sink.captures.isEmpty)
    }

    @Test func theCarouselNamesEachSlideAndDot() {
        #expect(WelcomeCopy.slidePosition(.story) == "1 of 6")
        #expect(WelcomeCopy.slidePosition(.tuner) == "6 of 6")
        #expect(WelcomeCopy.dotLabel(.catalog) == "Slide 2 of 6")
    }
}

#if os(macOS)
    import AppKit
    import ClerkKitUI

    @MainActor
    @Suite struct MacClerkThemeTests {
        /// `color`'s sRGB hex and alpha as drawn in `appearance`.
        private func resolved(_ color: Color, in appearance: NSAppearance.Name) -> (hex: String, alpha: Double)? {
            var result: (String, Double)?
            NSAppearance(named: appearance)?.performAsCurrentDrawingAppearance {
                result = NSColor(color).usingColorSpace(.sRGB).map {
                    (
                        KeyColor.RGB(
                            red: Double($0.redComponent), green: Double($0.greenComponent),
                            blue: Double($0.blueComponent)
                        ).hex, Double($0.alphaComponent)
                    )
                }
            }
            return result
        }

        @Test(arguments: [(NSAppearance.Name.aqua, ColorScheme.light), (.darkAqua, .dark)])
        func clerkThemeUsesMacTokens(appearance: NSAppearance.Name, scheme: ColorScheme) {
            let theme = ClerkTheme.crosstune(.mac)
            let colors = theme.colors
            let expected: [(Color, Palette.Token, String)] = [
                (colors.primary, .accentFill, "primary"), (colors.ring, .accent, "ring"),
                (colors.inputBorderFocused, .accent, "inputBorderFocused"), (colors.background, .ground, "background"),
                (colors.input, .surface, "input"), (colors.muted, .surface, "muted"),
                (colors.foreground, .ink, "foreground"), (colors.neutral, .ink, "neutral"),
                (colors.inputForeground, .ink, "inputForeground"),
                (colors.mutedForeground, .inkSecondary, "mutedForeground"),
                (colors.primaryForeground, .onAccentFill, "primaryForeground"),
            ]
            for (color, token, name) in expected {
                #expect(resolved(color, in: appearance)?.hex == Palette.hex(token, scheme).lowercased(), "\(name)")
            }
            // The 4pt halo Clerk draws around a field is the input border; it stays clear.
            #expect(resolved(colors.inputBorder, in: appearance)?.alpha == 0)
            // Pressed follows the Mac primary button's pressed fill in each appearance.
            let pressed = MacButtonStyle.fillRGB(for: .primary, scheme: scheme, isPressed: true)
            #expect(resolved(colors.primaryPressed, in: appearance)?.hex == pressed?.hex)
            #expect(theme.design.borderRadius == 8)
        }
    }
#endif
