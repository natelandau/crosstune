import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct WelcomeTests {
    @Test func theHeadlineNamesTheDevice() {
        #expect(WelcomeCopy.headline(for: .phone) == "The tune list in your case, rebuilt for your phone.")
        #expect(WelcomeCopy.headline(for: .pad) == "The tune list in your case, rebuilt for your iPad.")
        #expect(WelcomeCopy.headline(for: .mac) == "The tune list in your case, rebuilt for your Mac.")
    }

    @Test func theWaitlistOpensOnTheSite() {
        #expect(WelcomeCopy.waitlistURL.absoluteString == "https://crosstune.app/waitlist")
    }

    @Test func thePictureYieldsAtAccessibilitySizes() {
        #expect(WelcomeLayout.showsPicture(.large))
        #expect(WelcomeLayout.showsPicture(.xxxLarge))
        #expect(!WelcomeLayout.showsPicture(.accessibility1))
        #expect(!WelcomeLayout.showsPicture(.accessibility5))
    }
}
