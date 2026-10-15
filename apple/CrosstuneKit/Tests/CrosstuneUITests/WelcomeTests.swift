import CrosstuneAuth
import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct WelcomeTests {
    @Test func theHeadlineNamesTheDevice() {
        #expect(WelcomeCopy.headline(for: .phone) == "The tune list in your case, rebuilt for your phone.")
        #expect(WelcomeCopy.headline(for: .pad) == "The tune list in your case, rebuilt for your iPad.")
        #expect(WelcomeCopy.headline(for: .mac) == "The tune list in your case, rebuilt for your Mac.")
    }

    @Test func createAccountLeadsAndSignInFollows() {
        #expect(WelcomeButton.allCases.map(\.label) == [WelcomeCopy.createAccount, WelcomeCopy.signIn])
        #expect(WelcomeButton.allCases.filter(\.isProminent).map(\.label) == [WelcomeCopy.createAccount])
        #expect(WelcomeButton.allCases.filter { !$0.isProminent }.map(\.label) == [WelcomeCopy.signIn])
    }

    @Test func eachButtonOpensItsOwnFlow() {
        #expect(WelcomeButton.createAccount.mode == .signUp)
        #expect(WelcomeButton.signIn.mode == .signIn)
    }

    @Test func thePictureYieldsAtAccessibilitySizes() {
        #expect(WelcomeLayout.showsPicture(.large))
        #expect(WelcomeLayout.showsPicture(.xxxLarge))
        #expect(!WelcomeLayout.showsPicture(.accessibility1))
        #expect(!WelcomeLayout.showsPicture(.accessibility5))
    }
}
